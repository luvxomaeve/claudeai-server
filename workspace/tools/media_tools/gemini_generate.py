#!/usr/bin/env python3
"""
Gemini image and video generation tool.
Uses Google Imagen (images) and Veo (videos) via google-genai SDK.

Usage:
  # Generate image
  python3 tools/media_tools/gemini_generate.py --type image --prompt "a cat in space" [--model imagen-4-ultra] [--aspect 16:9]

  # Generate video
  python3 tools/media_tools/gemini_generate.py --type video --prompt "a drone flyover" [--model veo-3] [--duration 5] [--aspect 16:9]

  # Generate image from reference image
  python3 tools/media_tools/gemini_generate.py --type image --prompt "make it cartoon style" --reference /path/to/image.jpg

Output: saves file to workspace/output_to_user/ and prints the path as JSON.
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path

def get_api_key():
    key = os.environ.get("GEMINI_API_KEY")
    if key:
        return key
    env_file = Path.home() / ".ductor" / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line.startswith("GEMINI_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    config_file = Path.home() / ".ductor" / "config" / "config.json"
    if config_file.exists():
        cfg = json.loads(config_file.read_text())
        val = cfg.get("gemini_api_key")
        if val and val != "null":
            return val
    return None


def generate_image(client, prompt, model="imagen-4-ultra", aspect_ratio="1:1",
                   reference_path=None, number_of_images=1):
    from google.genai import types

    output_dir = Path.home() / ".ductor" / "workspace" / "output_to_user"
    output_dir.mkdir(parents=True, exist_ok=True)

    config_kwargs = {
        "number_of_images": number_of_images,
        "aspect_ratio": aspect_ratio,
        "output_mime_type": "image/png",
    }

    generate_kwargs = {
        "model": model,
        "prompt": prompt,
        "config": types.GenerateImagesConfig(**config_kwargs),
    }

    if reference_path and os.path.exists(reference_path):
        ref_image = types.Image.from_file(reference_path)
        generate_kwargs["image"] = ref_image

    response = client.models.generate_images(**generate_kwargs)

    results = []
    for i, image in enumerate(response.generated_images):
        ts = int(time.time())
        suffix = f"_{i}" if number_of_images > 1 else ""
        filename = f"gemini_img_{ts}{suffix}.png"
        filepath = output_dir / filename
        image.image.save(str(filepath))
        results.append(str(filepath))

    return results


def generate_video(client, prompt, model="veo-3", aspect_ratio="16:9",
                   duration_seconds=5, reference_path=None):
    from google.genai import types

    output_dir = Path.home() / ".ductor" / "workspace" / "output_to_user"
    output_dir.mkdir(parents=True, exist_ok=True)

    config_kwargs = {
        "aspect_ratio": aspect_ratio,
        "output_mime_type": "video/mp4",
    }

    if duration_seconds:
        config_kwargs["duration_seconds"] = duration_seconds

    generate_kwargs = {
        "model": model,
        "prompt": prompt,
        "config": types.GenerateVideosConfig(**config_kwargs),
    }

    if reference_path and os.path.exists(reference_path):
        ref_image = types.Image.from_file(reference_path)
        generate_kwargs["image"] = ref_image

    # Video generation is async — returns an operation to poll
    operation = client.models.generate_videos(**generate_kwargs)

    # Poll until done (timeout ~5 min)
    max_wait = 300
    poll_interval = 10
    elapsed = 0
    while not operation.done and elapsed < max_wait:
        time.sleep(poll_interval)
        elapsed += poll_interval
        operation = client.operations.get(operation)
        print(json.dumps({"status": "generating", "elapsed": elapsed}), file=sys.stderr)

    if not operation.done:
        return {"error": "Video generation timed out after 5 minutes"}

    results = []
    for i, video in enumerate(operation.response.generated_videos):
        ts = int(time.time())
        suffix = f"_{i}" if len(operation.response.generated_videos) > 1 else ""
        filename = f"gemini_vid_{ts}{suffix}.mp4"
        filepath = output_dir / filename

        # Download video
        video_data = client.files.download(file=video.video)
        filepath.write_bytes(video_data)
        results.append(str(filepath))

    return results


MODEL_ALIASES = {
    # Image models
    "imagen-4-ultra": "imagen-4.0-ultra-generate-001",
    "imagen-4": "imagen-4.0-generate-001",
    "imagen-4-fast": "imagen-4.0-fast-generate-001",
    "imagen-3": "imagen-3.0-generate-002",
    # Video models
    "veo-3.1": "veo-3.1-generate-preview",
    "veo-3": "veo-3.0-generate-001",
    "veo-3-fast": "veo-3.0-fast-generate-001",
    "veo-2": "veo-2.0-generate-001",
}


def resolve_model(name):
    """Resolve short alias to full model ID."""
    return MODEL_ALIASES.get(name, name)


def list_models():
    """List available Gemini generation models."""
    return {
        "image_models": [
            {"id": "imagen-4-ultra", "full": "imagen-4.0-ultra-generate-001", "description": "Highest quality, slowest"},
            {"id": "imagen-4", "full": "imagen-4.0-generate-001", "description": "Good quality, balanced speed"},
            {"id": "imagen-4-fast", "full": "imagen-4.0-fast-generate-001", "description": "Fast generation"},
            {"id": "imagen-3", "full": "imagen-3.0-generate-002", "description": "Previous gen, fast"},
        ],
        "video_models": [
            {"id": "veo-3.1", "full": "veo-3.1-generate-preview", "description": "Latest preview, highest quality"},
            {"id": "veo-3", "full": "veo-3.0-generate-001", "description": "High quality video + audio"},
            {"id": "veo-3-fast", "full": "veo-3.0-fast-generate-001", "description": "Fast video generation"},
            {"id": "veo-2", "full": "veo-2.0-generate-001", "description": "Good quality video"},
        ],
        "aspect_ratios": ["1:1", "16:9", "9:16", "4:3", "3:4"],
    }


def main():
    parser = argparse.ArgumentParser(description="Gemini image/video generation")
    parser.add_argument("--type", choices=["image", "video", "models"], required=True,
                        help="Generation type")
    parser.add_argument("--prompt", type=str, help="Text prompt")
    parser.add_argument("--model", type=str, help="Model ID (default: imagen-4-ultra / veo-3)")
    parser.add_argument("--aspect", type=str, default=None, help="Aspect ratio (e.g. 16:9)")
    parser.add_argument("--reference", type=str, help="Reference image path")
    parser.add_argument("--count", type=int, default=1, help="Number of images (1-4)")
    parser.add_argument("--duration", type=int, default=5, help="Video duration in seconds")
    args = parser.parse_args()

    if args.type == "models":
        print(json.dumps(list_models(), indent=2))
        return

    if not args.prompt:
        print(json.dumps({"error": "Prompt is required"}))
        sys.exit(1)

    api_key = get_api_key()
    if not api_key:
        print(json.dumps({"error": "GEMINI_API_KEY not found in env, .env, or config"}))
        sys.exit(1)

    from google import genai
    client = genai.Client(api_key=api_key)

    if args.type == "image":
        model = resolve_model(args.model or "imagen-4-ultra")
        aspect = args.aspect or "1:1"
        count = min(max(args.count, 1), 4)
        try:
            paths = generate_image(client, args.prompt, model=model,
                                   aspect_ratio=aspect, reference_path=args.reference,
                                   number_of_images=count)
            print(json.dumps({"ok": True, "type": "image", "model": model, "files": paths}))
        except Exception as e:
            print(json.dumps({"error": str(e)}))
            sys.exit(1)

    elif args.type == "video":
        model = resolve_model(args.model or "veo-3")
        aspect = args.aspect or "16:9"
        try:
            paths = generate_video(client, args.prompt, model=model,
                                   aspect_ratio=aspect, duration_seconds=args.duration,
                                   reference_path=args.reference)
            if isinstance(paths, dict) and "error" in paths:
                print(json.dumps(paths))
                sys.exit(1)
            print(json.dumps({"ok": True, "type": "video", "model": model, "files": paths}))
        except Exception as e:
            print(json.dumps({"error": str(e)}))
            sys.exit(1)


if __name__ == "__main__":
    main()
