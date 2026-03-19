#!/usr/bin/env python3
"""
Telegram Chat/Channel Exporter
Exports messages from any chat/channel/group, including restricted ones.
Bypasses forwarding/saving restrictions via Telegram API.
"""

import asyncio
import json
import os
import sys
import argparse
from datetime import datetime
from pathlib import Path

from telethon import TelegramClient
from telethon.tl.types import (
    MessageMediaPhoto, MessageMediaDocument, MessageMediaWebPage,
    User, Chat, Channel
)

EXPORT_DIR = Path(__file__).parent.parent / "output_to_user" / "tg_exports"


def parse_args():
    p = argparse.ArgumentParser(description="Telegram Chat Exporter")
    p.add_argument("--api-id", type=int, required=True)
    p.add_argument("--api-hash", required=True)
    p.add_argument("--phone", help="Phone number for login")
    p.add_argument("--list", action="store_true", help="List all chats")
    p.add_argument("--chat", help="Chat ID, username, or invite link to export")
    p.add_argument("--limit", type=int, default=0, help="Max messages (0 = all)")
    p.add_argument("--media", action="store_true", help="Download media files")
    p.add_argument("--format", choices=["json", "txt", "html"], default="json")
    p.add_argument("--search", help="Search chats by name")
    return p.parse_args()


async def list_chats(client, search=None):
    """List all dialogs with their IDs."""
    dialogs = await client.get_dialogs()
    print(f"\n{'ID':<15} {'Type':<10} {'Title'}")
    print("-" * 60)
    for d in dialogs:
        entity = d.entity
        if isinstance(entity, User):
            dtype = "User"
            title = f"{entity.first_name or ''} {entity.last_name or ''}".strip()
        elif isinstance(entity, Chat):
            dtype = "Group"
            title = entity.title
        elif isinstance(entity, Channel):
            dtype = "Channel" if entity.broadcast else "Supergroup"
            title = entity.title
        else:
            dtype = "Unknown"
            title = d.name

        if search and search.lower() not in title.lower():
            continue

        restricted = ""
        if hasattr(entity, 'noforwards') and entity.noforwards:
            restricted = " 🔒"

        print(f"{d.entity.id:<15} {dtype:<10} {title}{restricted}")

    print(f"\n🔒 = restricted (forwarding disabled)")
    print(f"Total: {len(dialogs)} chats")


async def export_chat(client, chat_id, limit, download_media, fmt):
    """Export messages from a chat."""
    try:
        if chat_id.lstrip('-').isdigit():
            chat_id = int(chat_id)
        entity = await client.get_entity(chat_id)
    except Exception as e:
        print(f"Error: Could not find chat: {e}")
        return None

    # Get chat title
    if isinstance(entity, User):
        title = f"{entity.first_name or ''} {entity.last_name or ''}".strip()
    elif hasattr(entity, 'title'):
        title = entity.title
    else:
        title = str(chat_id)

    safe_title = "".join(c if c.isalnum() or c in " -_" else "_" for c in title)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    export_path = EXPORT_DIR / f"{safe_title}_{timestamp}"
    export_path.mkdir(parents=True, exist_ok=True)

    if download_media:
        media_dir = export_path / "media"
        media_dir.mkdir(exist_ok=True)

    print(f"\nExporting: {title}")
    print(f"Output: {export_path}")

    messages_data = []
    count = 0

    kwargs = {"limit": limit if limit > 0 else None}

    async for msg in client.iter_messages(entity, **kwargs):
        count += 1
        if count % 500 == 0:
            print(f"  ...{count} messages processed")

        msg_data = {
            "id": msg.id,
            "date": msg.date.isoformat() if msg.date else None,
            "sender_id": msg.sender_id,
            "text": msg.text or "",
            "reply_to": msg.reply_to_msg_id if msg.reply_to else None,
        }

        # Sender name
        if msg.sender:
            if isinstance(msg.sender, User):
                msg_data["sender_name"] = f"{msg.sender.first_name or ''} {msg.sender.last_name or ''}".strip()
            elif hasattr(msg.sender, 'title'):
                msg_data["sender_name"] = msg.sender.title
            else:
                msg_data["sender_name"] = str(msg.sender_id)
        else:
            msg_data["sender_name"] = "Unknown"

        # Media
        if msg.media:
            if isinstance(msg.media, MessageMediaPhoto):
                msg_data["media_type"] = "photo"
            elif isinstance(msg.media, MessageMediaDocument):
                doc = msg.media.document
                if doc:
                    for attr in doc.attributes:
                        if hasattr(attr, 'file_name'):
                            msg_data["file_name"] = attr.file_name
                            break
                    msg_data["media_type"] = doc.mime_type or "document"
                    msg_data["file_size"] = doc.size
                else:
                    msg_data["media_type"] = "document"
            elif isinstance(msg.media, MessageMediaWebPage):
                msg_data["media_type"] = "webpage"
                if msg.media.webpage and hasattr(msg.media.webpage, 'url'):
                    msg_data["webpage_url"] = msg.media.webpage.url
            else:
                msg_data["media_type"] = type(msg.media).__name__

            # Download media if requested
            if download_media and not isinstance(msg.media, MessageMediaWebPage):
                try:
                    path = await msg.download_media(file=str(media_dir))
                    if path:
                        msg_data["media_file"] = os.path.basename(path)
                except Exception as e:
                    msg_data["media_error"] = str(e)

        messages_data.append(msg_data)

    # Reverse to chronological order
    messages_data.reverse()

    print(f"  Total: {count} messages")

    # Save
    if fmt == "json":
        output_file = export_path / "messages.json"
        export_json = {
            "chat_title": title,
            "chat_id": entity.id if hasattr(entity, 'id') else str(chat_id),
            "exported_at": datetime.now().isoformat(),
            "message_count": len(messages_data),
            "messages": messages_data
        }
        with open(output_file, "w", encoding="utf-8") as f:
            json.dump(export_json, f, ensure_ascii=False, indent=2)

    elif fmt == "txt":
        output_file = export_path / "messages.txt"
        with open(output_file, "w", encoding="utf-8") as f:
            f.write(f"=== {title} ===\n")
            f.write(f"Exported: {datetime.now().isoformat()}\n")
            f.write(f"Messages: {len(messages_data)}\n\n")
            for m in messages_data:
                date = m['date'][:19] if m['date'] else '?'
                sender = m.get('sender_name', '?')
                text = m.get('text', '')
                media = f" [{m['media_type']}]" if 'media_type' in m else ""
                f.write(f"[{date}] {sender}:{media}\n")
                if text:
                    f.write(f"{text}\n")
                f.write("\n")

    elif fmt == "html":
        output_file = export_path / "messages.html"
        with open(output_file, "w", encoding="utf-8") as f:
            f.write(f"""<!DOCTYPE html>
<html><head><meta charset="utf-8">
<title>{title}</title>
<style>
body {{ font-family: -apple-system, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; background: #0e1621; color: #fff; }}
.msg {{ margin: 8px 0; padding: 10px 14px; background: #182533; border-radius: 12px; }}
.sender {{ color: #6ab3f3; font-weight: bold; font-size: 13px; }}
.date {{ color: #6d7883; font-size: 11px; float: right; }}
.text {{ margin-top: 4px; line-height: 1.4; white-space: pre-wrap; }}
.media {{ color: #6d7883; font-style: italic; font-size: 12px; }}
h1 {{ color: #6ab3f3; }}
</style></head><body>
<h1>{title}</h1>
<p style="color:#6d7883">Exported: {datetime.now().strftime('%Y-%m-%d %H:%M')} | Messages: {len(messages_data)}</p>
""")
            for m in messages_data:
                date = m['date'][:16].replace('T', ' ') if m['date'] else ''
                sender = m.get('sender_name', '?')
                text = (m.get('text', '') or '').replace('<', '&lt;').replace('>', '&gt;')
                media_tag = f'<div class="media">[{m["media_type"]}]</div>' if 'media_type' in m else ""
                f.write(f'<div class="msg"><span class="sender">{sender}</span><span class="date">{date}</span>')
                if text:
                    f.write(f'<div class="text">{text}</div>')
                f.write(f'{media_tag}</div>\n')
            f.write("</body></html>")

    print(f"  Saved: {output_file}")
    return str(output_file)


async def main():
    args = parse_args()

    session_path = str(Path(__file__).parent.parent / "tg_export_session")
    client = TelegramClient(session_path, args.api_id, args.api_hash)

    await client.connect()
    if not await client.is_user_authorized():
        if not args.phone:
            print("Error: Not authorized. Provide --phone for first login.")
            await client.disconnect()
            return
        await client.start(phone=args.phone)
    print("✓ Connected to Telegram")

    if args.list or args.search:
        await list_chats(client, search=args.search)
    elif args.chat:
        result = await export_chat(
            client, args.chat, args.limit,
            args.media, args.format
        )
        if result:
            print(f"\n✓ Export complete: {result}")
    else:
        print("Use --list to see chats, or --chat ID to export")

    await client.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
