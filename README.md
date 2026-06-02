# Polza.ai API Proxy

OpenAI-совместимый прокси перед [Polza.ai](https://polza.ai). Принимает стандартные запросы от IDE/CLI (которые не умеют задавать кастомные параметры), дописывает в них Polza-специфичные поля — [provider selection](https://polza.ai/docs/gaidy/provider-selection) — и прозрачно форвардит на `https://polza.ai/api/v1`.

## Оглавление

- [Быстрый старт](#быстрый-старт)
- [Использование в IDE/CLI](#использование-в-idecli)
- [Проксируемые эндпоинты](#проксируемые-эндпоинты)
- [Конфигурация](#конфигурация)
- [Инъекции](#инъекции)
- [Переменные окружения](#переменные-окружения)
- [Логи и безопасность](#логи-и-безопасность)
- [Запуск и диагностика](#запуск-и-диагностика)
- [Структура проекта](#структура-проекта)

## Быстрый старт

```bash
npm install
cp config.example.json config.json
# отредактируй config.json — как минимум polzaApiKey, если не хочешь передавать ключ от клиента
npm start
```

Если `config.json` нет — `npm start` запустит интерактивный мастер настройки и создаст его в текущей директории.

По умолчанию прокси слушает `http://127.0.0.1:8787`. При старте печатает зелёный ASCII-баннер с версией, адресом и апстримом.

### Системные требования

- Node.js **≥ 20** (см. `engines.node` в `package.json`)
- Один npm-пакет: `fastify` (больше ничего не тянется)

## Использование в IDE/CLI

В настройках клиента укажи:

- **Base URL**: `http://127.0.0.1:8787/v1` (или `http://127.0.0.1:8787` — прокси нормализует префикс `/v1` сам)
- **API key**: твой Polza-ключ, либо любой placeholder если `polzaApiKey` задан в `config.json`

Если клиент прислал свой `Authorization` — он передаётся на апстрим **без изменений**. `polzaApiKey` из конфига подставляется только когда клиентского ключа нет.

## Проксируемые эндпоинты

Прокси форвардит **любой** путь `/*` и `/v1/*`. JSON-тела парсятся, на выбранных путях в них докидываются поля из `inject`; всё остальное (multipart, бинарные аплоады) форвардится как есть.

| Путь | Метод | Тип тела | Инъекция |
|------|-------|----------|----------|
| `/v1/chat/completions` | POST | JSON | ✅ да |
| `/v1/completions` | POST | JSON | ✅ да |
| `/v1/responses` | POST | JSON | ✅ да |
| `/v1/media` | POST | multipart/form-data | — (форвард as-is) |
| `/v1/audio/transcriptions` | POST | multipart/form-data | — (форвард as-is) |
| `/v1/audio/speech` | POST | JSON → аудио-ответ | — |
| `/v1/embeddings` | POST | JSON | — |
| `/v1/models` и прочее | любой | — | — |

Список путей для инъекции вшит в `src/config.js` (`INJECT_PATHS`) и не настраивается через конфиг. Инъекция применяется только к JSON-телам — multipart-запросы проходят через прокси нетронутыми.

Также прокси добавляет собственный `GET /health` → `{"ok": true}`.

## Конфигурация

`config.json` ищется в следующем порядке:

1. Путь из переменной окружения `POLZA_PROXY_CONFIG`.
2. `./config.json` в текущей рабочей директории (`cwd`).

Если файл не найден и `stdin` — TTY, запускается мастер настройки и создаёт файл в `cwd`. Без TTY процесс завершается с понятной ошибкой.

### Поля

```json
{
  "port": 8787,
  "host": "127.0.0.1",
  "polzaApiKey": "",
  "inject": {
    "provider": {
      "order": ["OpenAI", "Anthropic"],
      "allow_fallbacks": true
    }
  },
  "modelProviders": {
    "deepseek/deepseek-v4-pro": {
      "only": ["DeepSeek"],
      "allow_fallbacks": false
    }
  }
}
```

| Поле | Тип | По умолчанию | Описание |
|------|-----|--------------|----------|
| `port` | integer `1–65535` | `8787` | Порт локального прокси. При занятом — процесс падает с понятной ошибкой. |
| `host` | string | `"127.0.0.1"` | Интерфейс. Поставь `"0.0.0.0"` чтобы слушать все. |
| `polzaApiKey` | string | `""` | Fallback API-ключ. Используется, если клиент не прислал `Authorization`. |
| `inject` | object | `{}` | Поля, дописываемые в JSON-тело на `INJECT_PATHS`. Клиентское значение никогда не перетирается. Подробнее → [Инъекции](#инъекции). |
| `modelProviders` | object | `{}` | Per-model provider selection. Ключ — имя модели, значение — объект `provider` (те же поля: `only`, `order`, `allow_fallbacks`). Если модель запроса найдена здесь, её `provider` **полностью заменяет** глобальный `inject.provider`. Остальные ключи из `inject` работают как обычно. Подробнее → [Model-specific providers](#model-specific-providers). |

Захардкожено в `src/config.js` и **не меняется** через конфиг: `UPSTREAM_BASE_URL` и `INJECT_PATHS`. Чтобы поменять — правь исходник.

## Инъекции

Инъекция срабатывает только для `POST` на эндпоинты из `INJECT_PATHS` (`/chat/completions`, `/completions`, `/responses`). На остальное (audio, embeddings, media, models) тело не трогается.

**Главный принцип:** если клиент уже задал поле — оно не перетирается. Прокси только дописывает недостающее.

### Provider selection

[Документация](https://polza.ai/docs/gaidy/provider-selection).

```json
{
  "inject": {
    "provider": {
      "order": ["OpenAI", "Anthropic"],
      "allow_fallbacks": true
    }
  }
}
```

Варианты: `order`, `only`, `allow_fallbacks`, и т. д. — как в доке Polza.

### Model-specific providers

`modelProviders` позволяет привязать конкретную модель к конкретному провайдеру, не затрагивая глобальные настройки для остальных моделей.

```json
{
  "modelProviders": {
    "deepseek/deepseek-v4-pro": {
      "only": ["DeepSeek"],
      "allow_fallbacks": false
    },
    "xiaomi/mimo-v2.5-pro": {
      "only": ["Xiaomi", "DeepInfra"],
      "allow_fallbacks": true
    }
  }
}
```

**Как работает:**
1. Если в теле запроса есть поле `model` и оно найдено в `modelProviders` — для этой модели инжектится **свой** `provider`, полностью заменяя глобальный `inject.provider`.
2. Если модели нет в `modelProviders` — работает глобальный `inject.provider` (текущее поведение).
3. Если клиент **уже прислал** `provider` в теле запроса — ни глобальная, ни per-model настройка не применяется (клиентское значение всегда в приоритете).
4. Все остальные поля из `inject` (кроме `provider`) инжектятся одинаково для всех моделей.

## Переменные окружения

| Переменная | Назначение |
|------------|------------|
| `POLZA_PROXY_CONFIG` | Путь к `config.json`. Переопределяет поиск в `cwd`. |
| `POLZA_API_KEY` | Fallback-ключ, если в `config.json` пустой `polzaApiKey`. Приоритет: файл → env → пусто. |
| `LOG_LEVEL` | Уровень pino-логгера (`trace`/`debug`/`info`/`warn`/`error`). По умолчанию `info`. |
| `DEBUG_BODIES` | `1`/`true`/`yes` — логировать исходящие тела запросов и голову ответа/стрима. Полезно для отладки инъекций. |
| `NO_COLOR` | Любое значение — отключает цвета в баннере и предупреждениях. |
| `COLORTERM` | `truecolor` / `24bit` → баннер использует 24-битный зелёный `#39FF14`; иначе — 256-цветный bright green (ANSI 82). |

## Логи и безопасность

- Заголовки `Authorization`, `X-API-Key`, `Cookie` в pino-логах заменяются на `[redacted]`. Ключ в stdout не светится.
- Тела запросов/ответов Fastify **по умолчанию не логирует**. Включи `DEBUG_BODIES=1` только на время отладки.
- Hop-by-hop заголовки (`connection`, `keep-alive`, `transfer-encoding`, `content-length`, `accept-encoding` и прочие) не прокидываются ни в запрос к апстриму, ни в ответ клиенту.
- SSE (`text/event-stream`, `stream: true`) форвардится как есть — прокси не буферизует стрим.
- `bodyLimit`: 50 MiB. Тела с `Content-Type`, отличным от `application/json` (например, `multipart/form-data` для `/v1/audio/transcriptions` и `/v1/media`), форвардятся как бинарный буфер без попытки парсинга.

## Запуск и диагностика

### Баннер

При успешном старте — зелёный ASCII-баннер + строка:

```
version: <X.Y.Z>  |  listening on http://<host>:<port>  |  upstream: https://polza.ai/api/v1
```

Версия читается из `package.json`.

### Предупреждения и ошибки

- **`⚠  No API key configured`** (жёлтый warning) — ни в `config.polzaApiKey`, ни в `POLZA_API_KEY` нет ключа. Прокси запустится, но запросы без клиентского `Authorization` получат 401 от апстрима.
- **`Port <N> is already in use`** — понятная ошибка с путём до `config.json` вместо стектрейса.
- **`Invalid port ...`** — некорректное значение `port` в конфиге (не integer или вне `1..65535`).
- **`Config file not found ... stdin is not a TTY`** — конфига нет и wizard не может быть запущен (например, в CI). Создай `config.json` или задай `POLZA_PROXY_CONFIG`.

### Health check

```bash
curl http://127.0.0.1:8787/health
# {"ok":true}
```

### Как работает (под капотом)

1. Принимает запрос на любом пути (`/*` и `/v1/*`).
2. Нормализует путь: срезает префикс `/v1`, отделяет query string.
3. Для `POST` на `INJECT_PATHS`:
   - Применяет `applyInjections`: каждую пару `[key, value]` из `config.inject` кладёт в body, если клиент не задал её сам.
4. Строит заголовки для апстрима: копирует клиентские (кроме hop-by-hop), подставляет `Authorization: Bearer <polzaApiKey>` если клиент свой не прислал.
5. Выполняет `fetch` к `UPSTREAM_BASE_URL + путь`.
6. Форвардит статус, заголовки и body (стримом для SSE, иначе — просто `Readable.fromWeb`).
7. Ошибки `fetch` превращаются в `502` с телом `{"error":{"message":"Upstream request failed","detail":"..."}}`.

## Структура проекта

```
src/
  server.js    — HTTP-сервер Fastify, роутинг, инъекции, форвардинг
  config.js    — загрузка config.json, валидация, константы UPSTREAM_BASE_URL и INJECT_PATHS
  wizard.js    — интерактивный мастер первого запуска (readline)
  banner.js    — ASCII-баннер + определение цветовой поддержки терминала
config.example.json  — минимальный шаблон конфига
```

### Скрипты npm

| Команда | Что делает |
|---------|------------|
| `npm start` | Запуск: `node src/server.js` |
| `npm run dev` | То же с `--watch` — авто-рестарт при изменении `src/**` |
