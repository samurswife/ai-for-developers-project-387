# Проверки качества

Команды выполняются из корня репозитория.

Все проверки: `mise run check`. Для работы нужны Chromium (`mise run setup:browsers`) и доступ к сети для OSV.
`mise run setup` устанавливает зависимости, Chromium и Git-хуки hk. Для отдельной установки хуков:
`mise exec -- hk install --mise`.

Перед коммитом hk запускает `mise run check`, затем проверяет сообщение по Conventional Commits.
GitHub Actions запускает `mise run setup` и `mise run check` для PR в `main`, push основной ветки
и ручного запуска через `.github/workflows/check.yml`. Отдельный `browser-head` сохраняет свидетельства
точного head SHA; формат и проверка — в [docs/ci.md](../../docs/ci.md).

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
| `mise run lint:workflows` | Jactionlint 2.4.0: проверки, релизы, ручной OpenCode, автотриаж, авторевью и итог запроса; тесты допуска, бюджета, контекста и публикации с фикстурами API |
| `mise run lint:agents` | Agnix: инструкции в AGENTS.md |
| `mise run scan:secrets` | Betterleaks: секреты в файлах с редактированием значений в отчёте |
| `mise run scan:vulnerabilities` | OSV Scanner: уязвимости зависимостей из lockfile; нужен доступ к сети |

`tools/opencode/environment.test.mjs` проверяет подготовку среды до модели и настройки разрешений ручного workflow.
В `Project checks` переменная `OPENCODE_PERMISSION_PROBE=true` дополнительно включает интеграционную проверку:
закреплённый CLI загружается с SHA-256 и выполняет реальные команды проверки разрешений из workflow без ключа
и вызова модели. Прежние настройки должны давать `ask` для `/home/runner/*`, новые — `deny`.
Для локальной проверки уже загруженным CLI `v1.19.4` задайте также `OPENCODE_TEST_CLI=/путь/к/opencode`.
Отдельная проверка реального mise воспроизводит потерю установленных инструментов после смены `XDG_DATA_HOME`;
с явным `MISE_DATA_DIR` пути и версии сохраняются, а команда проекта и hk запускаются без автоустановки.

Для обновления сгенерированных файлов используйте `mise run generate`, для проверки типов — `mise run typecheck`.

`lint:commits` проверяет полные сообщения всех коммитов, включая merge-коммиты, от базового коммита
`11aafe53c312e4eaacbece67ef2ab5d65e42111a` до `HEAD` общей конфигурацией Commitlint.
Это последний коммит начального шаблона проекта `387`; история первого проекта сюда не переносилась.
Единственное явное исключение — опубликованный squash-коммит
`5a121e816e4f18b95cb9728865f744407723bd2d`: в его теле осталась строка длиннее 100 символов
([#32](https://github.com/samurswife/ai-for-developers-project-387/issues/32)). Его полный SHA пропускается
с предупреждением в логе, чтобы не переписывать опубликованную историю. Все остальные коммиты,
как до него, так и после, проверяются прежними строгими правилами. Копия того же сообщения
в другом коммите отклоняется. Исключение действует и при явном `--from`.
Для проверки исходного сообщения без исключения передайте вывод
`git show --no-patch --format=%B 5a121e816e4f18b95cb9728865f744407723bd2d` напрямую в Commitlint.
Все последующие merge-коммиты должны иметь заголовок Conventional Commits и строки тела не длиннее 100 символов.
Стандартные автоматические исключения Commitlint отключены, в том числе для заголовков вида `Merge branch ...`.
Правила также действуют в `commit-msg`. Нужна полная история Git; пустой диапазон проходит проверку.
Команда также запускает регрессионные проверки CLI на временных Git-репозиториях.
Для другого диапазона: `mise exec -- pnpm run lint:commits --from <base> --to <head>`.

Для проверки отдельного сообщения:
`printf '%s\n' 'feat: описание' | mise exec -- pnpm exec commitlint`.

Перед squash-merge проверяйте файл с точными итоговыми заголовком, пустой строкой и телом:
`mise exec -- pnpm exec commitlint --edit /tmp/pr-merge-message.txt`.
В merge API передавайте именно проверенный текст: сообщение нового squash-коммита ещё не существует при CI ветки PR.

## Локальное исправление picomatch

До исправленного upstream-релиза `picomatch` обе версии (2.3.2 и 4.0.7) получают
заплаты из `patches/` через `patchedDependencies` pnpm. Они закрывают
[GHSA-fc5q-39xc-vjpf](https://osv.dev/vulnerability/GHSA-fc5q-39xc-vjpf):
повторяемый extglob с одиночной ветвью и неограниченным wildcard обрабатывается
существующим безопасным механизмом литерализации опасного шаблона.
Обычные glob, альтернативы и экранированные звёздочки сохраняют поведение.

`scan:vulnerabilities` сначала запускает `picomatch.test.mjs` на реальных зависимостях
Stylelint и dependency-cruiser. Опасные шаблоны исполняются в отдельных процессах
с тайм-аутом; тест также проверяет охват всех версий из lockfile.
Без заплат сканирование не начнётся, команда завершится ошибкой теста.
OSV определяет исходные версии по lockfile и не учитывает заплаты,
поэтому для этого advisory задано ограниченное по времени исключение до 2 декабря 2026 года.
Остальные advisory проверяются обычным образом.

При выходе исправленного релиза обновите обе цепочки зависимостей, удалите заплаты
и исключение из `osv-scanner.toml`, затем выполните `mise run check`.
Сохраните проверки времени обработки как защиту от повторения.
