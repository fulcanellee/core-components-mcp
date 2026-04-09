# Minimal MCP Server

Минимальный MCP сервер на официальном TypeScript SDK.

## Что внутри

- transport: `stdio`
- 1 tool: `hello_world`

## Установка

```bash
npm install
```

## Запуск в dev-режиме

```bash
npm run dev
```

## Что делает tool

`hello_world` принимает необязательный параметр `name` и возвращает текстовое приветствие.

Пример логики:

- без аргументов: `Hello, world! This response came from your MCP server.`
- c `name: "John"`: `Hello, John! This response came from your MCP server.`

## Следующий шаг

Подключить сервер к MCP-клиенту, который умеет запускать локальные `stdio` серверы.

## Конфиг подключения

Ниже универсальные примеры в формате `mcpServers`, без привязки к конкретному клиенту.

Готовые файлы примеров:

- `examples/mcp.dev.json`

### Dev-режим

Когда сервер запускается напрямую из TypeScript:

```json
{
  "mcpServers": {
    "core-components-mcp-dev": {
      "command": "npm",
      "args": ["run", "dev"],
      "cwd": "path/to/folder"
    }
  }
}
```
