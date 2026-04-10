# core-components-mcp

MCP-сервер, предоставляющий информацию о компонентах core UI библиотеки через три инструмента.

## Инструменты

| Инструмент | Описание |
|------------|----------|
| `list_components` | Возвращает список всех доступных компонентов |
| `get_component` | Возвращает детали компонента (props, типы, описания) по имени пакета или компонента |
| `generate_component_usage` | Помогает написать код использования компонента с примерами, импортами и props |

## Установка

```bash
npm install
```

## Запуск в dev-режиме

```bash
npm run dev
```

## Сборка и prod-запуск

```bash
npm run build
npm start
```

## Конфиг подключения

Примеры файлов конфигурации: `examples/mcp.dev.json`

### Dev-режим

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

### Из установленного npm-пакета

```json
{
  "mcpServers": {
    "core-components-mcp": {
      "command": "npx",
      "args": ["-y", "core-components-mcp"]
    }
  }
}
```
