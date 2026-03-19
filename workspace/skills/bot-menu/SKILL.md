---
name: bot-menu
description: Main bot menu and command handler. Trigger on /menu, /start, /help, /settings, /commands, or when user asks for menu, commands, or bot features. Also handles /img, /image, /video, /gen, /cron, /tasks, /memory, /agents, /vpn, /permissions commands.
allowed-tools: Bash,Read,Write,Edit
---

# Bot Menu & Commands

## Command Routing

When user sends a command, respond with the appropriate action:

### Generation Commands
- `/img <prompt>` or `/image <prompt>` — generate image with Imagen 4 Ultra, send result
- `/video <prompt>` — generate video with Veo 3, send result
- `/gen` — show generation menu (see below)

### System Commands
- `/menu` or `/start` — show main menu
- `/help` or `/commands` — show all commands
- `/settings` — show settings menu
- `/permissions` — toggle permissions mode

### Tool Commands
- `/cron` — show active cron tasks
- `/tasks` — show background tasks
- `/agents` — list sub-agents
- `/vpn` — VPN status and management
- `/memory` — show what bot remembers about user

---

## Menu Layouts

### /menu or /start — Main Menu

```
🤖 Ductor — главное меню

Что делаем?

[button:🖼 Генерация] [button:⚙️ Настройки]
[button:📋 Задачи] [button:🤖 Агенты]
[button:🔐 VPN] [button:💾 Память]
[button:❓ Команды]
```

### 🖼 Генерация (or /gen)

```
🎨 Генерация контента

Выбери тип:

[button:🖼 Картинку] [button:🎬 Видео]
```

After "🖼 Картинку":
```
Выбери модель:

[button:⭐ Imagen 4 Ultra] [button:🎨 Imagen 4]
[button:⚡ Imagen 4 Fast] [button:📷 Imagen 3]

Формат:
[button:1:1] [button:16:9] [button:9:16]
```
Then ask for prompt: "Опиши что сгенерировать:"

After "🎬 Видео":
```
Выбери модель:

[button:🌟 Veo 3.1] [button:🎬 Veo 3]
[button:⚡ Veo 3 Fast] [button:📹 Veo 2]

Формат:
[button:16:9] [button:9:16] [button:1:1]
```
Then ask for prompt: "Опиши что сгенерировать:"

### ⚙️ Настройки (or /settings)

```
⚙️ Настройки бота

[button:🔓 Права доступа] [button:🌐 Язык]
[button:🧠 Модель AI] [button:📊 Стриминг]
[button:⏰ Таймзона] [button:🔄 Рестарт бота]
[button:⬅️ Назад в меню]
```

For "🔓 Права доступа":
- Run `python3 tools/user_tools/toggle_permissions.py` to check current state
- Show current mode and toggle button

For "🧠 Модель AI":
```
Текущая модель: Claude Opus

[button:Claude Opus] [button:Claude Sonnet]
[button:⬅️ Назад]
```

For "🔄 Рестарт бота":
- Confirm with user, then `touch ~/.ductor/restart-requested`

### 📋 Задачи (or /tasks)

- Run `python3 tools/task_tools/list_tasks.py` and show active tasks
- If no tasks: "Нет активных задач"
```
[button:➕ Новая задача] [button:⬅️ Назад в меню]
```

### 🤖 Агенты (or /agents)

- Run `python3 tools/agent_tools/list_agents.py` and show list
```
[button:➕ Создать агента] [button:⬅️ Назад в меню]
```

### 🔐 VPN (or /vpn)

- Show VPN connection info
- Check xray status: `sudo systemctl status x-ui --no-pager -l`
```
🔐 VPN Status

Сервер: 72.56.107.35
Протокол: VLESS Reality
Порт: 443
Панель: 3x-ui

[button:📊 Статус Xray] [button:🔄 Рестарт VPN]
[button:📋 Показать ключ] [button:⬅️ Назад в меню]
```

### 💾 Память (or /memory)

- Read and summarize `memory_system/MAINMEMORY.md`
- Show key facts the bot remembers
```
[button:✏️ Редактировать] [button:🗑 Очистить] [button:⬅️ Назад в меню]
```

### ❓ Команды (or /help or /commands)

```
📝 Все команды:

🎨 Генерация:
  /img <промпт> — картинка (Imagen 4 Ultra)
  /image <промпт> — то же самое
  /video <промпт> — видео (Veo 3)
  /gen — меню генерации с выбором модели

📋 Система:
  /menu — главное меню
  /settings — настройки
  /permissions — переключить права
  /tasks — фоновые задачи
  /agents — суб-агенты
  /cron — крон задачи

🔐 Сервер:
  /vpn — статус VPN
  /memory — что я помню

💡 Или просто пиши что нужно — я пойму!

[button:⬅️ Назад в меню]
```

## Behavior Rules

1. Always respond in Russian
2. Keep menus compact — mobile-friendly
3. After every action, show relevant follow-up buttons
4. "⬅️ Назад в меню" always returns to main menu
5. If user types a command with arguments (e.g. `/img кот в космосе`), execute immediately without showing submenu
6. If user types just the command without arguments (e.g. `/img`), show the model selection menu first
