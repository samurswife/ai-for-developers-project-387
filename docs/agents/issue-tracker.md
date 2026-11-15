# Трекер задач

Задачи, спецификации и карты решений хранятся в GitHub Issues:
<https://github.com/samurswife/ai-for-developers-project-387/issues>

Используй GitHub CLI из корня репозитория.
Перед первой записью проверь целевой репозиторий:
`gh repo view --json nameWithOwner`.
Ожидаемый результат: `samurswife/ai-for-developers-project-387`.

- Прочитать задачу: `gh issue view <number> --comments`.
- Найти задачи: `gh issue list`.
- Создать задачу: `gh issue create --title "..." --body-file <file>`.
- Для многострочного текста используй UTF-8 файл с настоящими переносами строк.
- Связи между задачами оформляй через GitHub sub-issues и native dependencies.
- Если связи недоступны, используй `Part of #<number>` и `Blocked by: #<number>`.
- При публикации спецификации создавай GitHub Issue.
- Перед закрытием задачи опубликуй результат и выполненные проверки.

PRs as a request surface: no.

Для wayfinder используй метки `wayfinder:map` и `wayfinder:<type>`,
где type — research, prototype, grilling или task.
Карта содержит ссылки на дочерние задачи и принятые решения.

## Исходная спецификация и решения

Приложение перенесено из `samurswife/ai-for-developers-project-386`.
Новые задачи создавай в текущем репозитории `387`; ссылки ниже ведут к историческим источникам проекта `386`.
Ссылки на исходные задачи указывай полными URL, чтобы их номера не воспринимались как задачи нового репозитория.

- [Исходная спецификация](https://github.com/samurswife/ai-for-developers-project-386/issues/9).
- [Карта решений](https://github.com/samurswife/ai-for-developers-project-386/issues/1).
- [Границы первой версии](https://github.com/samurswife/ai-for-developers-project-386/issues/2#issuecomment-6705064687).
- [Сущности и валидация](https://github.com/samurswife/ai-for-developers-project-386/issues/3#issuecomment-6705153146).
- [Слоты и представление времени](https://github.com/samurswife/ai-for-developers-project-386/issues/4#issuecomment-6705268323).
- [Атомарность, конфликты и повторы](https://github.com/samurswife/ai-for-developers-project-386/issues/5#issuecomment-6705338264).
- [Операции и ошибки API](https://github.com/samurswife/ai-for-developers-project-386/issues/6#issuecomment-6705441769).
- [Переходы и состояния интерфейса](https://github.com/samurswife/ai-for-developers-project-386/issues/7#issuecomment-6705554341).
- [Тестирование и требования к тикетам](https://github.com/samurswife/ai-for-developers-project-386/issues/8#issuecomment-6705672738).

Локальные документы предметной области: [словарь](../../GLOSSARY.md) и
[ADR главной страницы](../adr/0001-home-page.md). Правила их использования — в [domain.md](domain.md).
