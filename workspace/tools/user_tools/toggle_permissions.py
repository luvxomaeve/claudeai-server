#!/usr/bin/env python3
"""Toggle permission mode between default and bypassPermissions.

Usage:
    python3 toggle_permissions.py           # show current mode
    python3 toggle_permissions.py on        # enable full permissions
    python3 toggle_permissions.py off       # disable full permissions (safe mode)
"""
import json
import sys
from pathlib import Path

CONFIG = Path.home() / ".ductor" / "config" / "config.json"


def main():
    config = json.loads(CONFIG.read_text())
    current = config.get("permission_mode", "default")

    if len(sys.argv) < 2:
        mode_label = "ПОЛНЫЕ ПРАВА" if current == "bypassPermissions" else "ОБЫЧНЫЙ"
        print(json.dumps({"current_mode": current, "label": mode_label}))
        return

    action = sys.argv[1].lower()
    if action == "on":
        config["permission_mode"] = "bypassPermissions"
        new_label = "ПОЛНЫЕ ПРАВА"
    elif action == "off":
        config["permission_mode"] = "default"
        new_label = "ОБЫЧНЫЙ"
    else:
        print(f"Unknown action: {action}. Use 'on' or 'off'.")
        sys.exit(1)

    CONFIG.write_text(json.dumps(config, indent=2, ensure_ascii=False))
    print(json.dumps({
        "previous_mode": current,
        "new_mode": config["permission_mode"],
        "label": new_label,
        "status": "ok"
    }))


if __name__ == "__main__":
    main()
