# Modes

BuilderHelm is one workspace with three modes. Shared rail items
(Search, Tasks, Plugins, Skills, Automations) stay put while the mode
changes the main working context.

| Mode   | Route homes                         | Purpose                                      |
| ------ | ----------------------------------- | -------------------------------------------- |
| Agents | `/agents`                           | Installed CLIs you can run                   |
| Code   | `/space`, `/board`, `/swarm`        | Project: terminals, files, tasks, review     |
| Chats  | `/chat`                             | Conversation with an installed ACP agent     |

The plus menu (`⌘K`) is the fast path. It does not install agents or
grant plugin access. Plugins, Skills, and Automations remain honest
stubs until those phases land.

Existing services stay: Space, Swarm, Board, ACP chat, Git, Review,
Browser, Editor. This file only names where they appear.
