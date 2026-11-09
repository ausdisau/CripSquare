# CripSquare shared user journey and access test matrix

**Status:** Human test plan, not a completed audit. Each platform needs its own test evidence and date.

| Journey | Keyboard and switch | Screen reader / AAC | Privacy and safeguarding | Expected uncertainty | Human test gate |
| --- | --- | --- | --- | --- | --- |
| Village Square | All navigation and search without drag | Semantic headings, predictable order, readable status | No forced diagnosis or public member profile disclosure | Public/private boundaries visible | Review with community member using keyboard and screen reader |
| Communities | Join/leave, category filters and all dialogs | Text alternatives and large targets, AAC entry | Clear audience, no unconsented group joining | Community access notes are user reports | Reviewer checks dialog focus and error recovery |
| Forums | Post, reply, edit and report using keyboard | Editor and live messages announced; AAC phrase entry | Moderator roles enforced server-side, report without retaliation | Forum report != verified accessibility evidence | Human moderator and participant test |
| Stories | Draft, save, preview and undo | Accessible authoring and media alternatives | Explicit publication audience and revocation route | Personal experiences are not external facts | ATAG and screen reader authoring checks |
| Events | Search/filter and join, including at 400% zoom | Access notes and communication options read correctly | Venue/host verification transparent | Reported details may be outdated or Unknown | Functional-needs-based scenario test |
| Display preferences | All toggles via switch and keyboard | Preferences announced and persisted | Do not log health or access preference in analytics | None | Two devices, 200% text and reduced motion |
| Safety | Accessible report and complaint paths | AAC/voice/text alternatives; human-help route | Human escalation, non-retaliation, scoped disclosures | Never auto-determine abuse or reportability | Independent safeguarding and accessibility review |
| MapAble Signal | Create challenge, observation, review, export and delete | Keyboard map alternative, ordered list, AAC, clear states | Opt-in sharing, reviewer role and audit, no precise-location leaks | Missing/outdated/disputed evidence -> Unknown | User-co-design and evidence-policy acceptance |

Testing should include NVDA/Firefox or Chrome, VoiceOver/Safari or iOS, Android TalkBack, switch access, text-only keyboard entry, magnification, reduced motion and intermittent network. No test uses actual participant records. Do not mark a journey compliant merely because static tests or snapshots pass.
