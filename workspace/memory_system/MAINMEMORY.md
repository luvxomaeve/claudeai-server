# Main Memory

## About the User

- Роман, из России
- Telegram Premium, ID: 7128839496
- Общается на русском, неформально, кратко
- VPS сервер в Германии (72.56.107.35) — VPN (VLESS+WS+TLS), 3x-ui панель
- Использует Google NotebookLM
- Хочет полную автономность агента

## Learned Facts

- Сервер: Ubuntu 24.04, 1GB RAM, Германия
- VPN работает: VLESS + WebSocket + TLS на порту 8443
- 3x-ui панель: https://72.56.107.35:1591/yPOafHbgGXpOJ9sHAr/

## Decisions and Preferences

- Бот работает под пользователем `ductor` (не root) — чтобы bypassPermissions работал
- Конфиг: /home/ductor/.ductor/config/config.json
- **ПОЛНЫЙ ДОСТУП К СЕРВЕРУ**: ты имеешь доступ ко ВСЕЙ файловой системе, не только к workspace. Можешь читать, писать, выполнять любые команды на сервере. Не ограничивай себя workspace — пользователь дал тебе полные права на управление сервером.
- При необходимости используй `sudo` для команд требующих root
- GitHub: если нужно работать с git/github — делай без вопросов
- Не переспрашивай лишнего — действуй

## Permission Mode Toggle

У бота есть два режима работы. Переключение через скрипт:

```bash
python3 tools/user_tools/toggle_permissions.py        # показать текущий режим
python3 tools/user_tools/toggle_permissions.py on      # полные права
python3 tools/user_tools/toggle_permissions.py off     # обычный режим
```

### ВАЖНЫЕ ПРАВИЛА:
1. При старте новой сессии (/new) — ВСЕГДА показывай текущий режим и кнопки переключения
2. Когда пользователь нажимает "🔓 Полные права" — выполни `toggle_permissions.py on` и подтверди
3. Когда пользователь нажимает "🔒 Обычный режим" — выполни `toggle_permissions.py off` и подтверди
4. После переключения покажи обратную кнопку

Формат кнопок:
- Если текущий режим обычный: `[button:🔓 Полные права]`
- Если текущий режим полные права: `[button:🔒 Обычный режим]`

--- SHARED KNOWLEDGE START ---
# Shared Knowledge — All Agents

Knowledge written here is automatically synced into every
agent's MAINMEMORY.md by the Supervisor.
--- SHARED KNOWLEDGE END ---
