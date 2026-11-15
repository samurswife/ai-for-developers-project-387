# Проверки качества

Команды выполняются из корня репозитория.

Все проверки: `mise run check`. Для работы нужны Chromium (`mise run setup:browsers`) и доступ к сети для OSV.
`mise run setup` устанавливает зависимости, Chromium и Git-хуки hk. Для отдельной установки хуков:
`mise exec -- hk install --mise`.

Перед коммитом hk запускает `mise run check`, затем проверяет сообщение по Conventional Commits.
GitHub Actions запускает `mise run setup` и `mise run check` на каждый push через `.github/workflows/check.yml`.

| Команда | Проверка |
| --- | --- |
| `mise run lint` | Все перечисленные ниже задачи `lint:*` |
| `mise run test:api` | HTTP API настоящего backend: успехи, ошибки и соответствие OpenAPI |
| `mise run test` | Браузерные сценарии с настоящим backend |
| `mise run lint:code` | Oxlint: ошибки TS/JS, React и доступности |
| `mise run lint:css` | Stylelint: CSS с синтаксисом Tailwind |
| `mise run lint:format` | Oxfmt: форматирование исходников и конфигурации |
| `mise run lint:typespec` | Форматирование TypeSpec |
| `mise run lint:unused` | Knip: неиспользуемые файлы, экспорты и зависимости |
| `mise run lint:architecture` | Dependency cruiser: циклы импортов и границы пакетов |
| `mise run lint:versions` | Syncpack: согласованность и точные версии зависимостей |
| `mise run lint:commits` | Commitlint: Conventional Commits в истории разработки |
| `mise run lint:openapi` | Vacuum: ошибки и предупреждения OpenAPI |
| `mise run lint:generated` | Сравнение OpenAPI и SDK с независимой повторной генерацией |
| `mise run lint:markdown` | Rumdl: Markdown в каталогах приложений, пакетов и инструментов |
| `mise run lint:workflows` | Jactionlint 2.4.0: проверки проекта, релизы, ручной OpenCode и автотриаж; тесты guard с фикстурами GitHub API |
| `mise run lint:agents` | Agnix: инструкции в AGENTS.md |
| `mise run scan:secrets` | Betterleaks: секреты в файлах с редактированием значений в отчёте |
| `mise run scan:vulnerabilities` | OSV Scanner: уязвимости зависимостей из lockfile; нужен доступ к сети |

Для обновления сгенерированных файлов используйте `mise run generate`, для проверки типов — `mise run typecheck`.

`lint:commits` проверяет полные сообщения всех коммитов, включая merge-коммиты, от базового коммита
`11aafe53c312e4eaacbece67ef2ab5d65e42111a` до `HEAD` общей конфигурацией Commitlint.
Это последний коммит начального шаблона проекта `387`; история первого проекта сюда не переносилась.
Все последующие merge-коммиты должны иметь заголовок Conventional Commits и строки тела не длиннее 100 символов.
Стандартные автоматические исключения Commitlint отключены, в том числе для заголовков вида `Merge branch ...`.
Правила также действуют в `commit-msg`. Нужна полная история Git; пустой диапазон проходит проверку.
Команда также запускает регрессионные проверки CLI на временных Git-репозиториях.
Для другого диапазона: `mise exec -- pnpm run lint:commits --from <base> --to <head>`.

Для проверки отдельного сообщения:
`printf '%s\n' 'feat: описание' | mise exec -- pnpm exec commitlint`.
