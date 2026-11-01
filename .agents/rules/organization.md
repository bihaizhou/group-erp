# Organization module

The ERP has four business domains: Organization, Human Resources, Functional Platform (including company operations), and Company Development. Do not add a separate Project Operations top-level module.

Organization owns entities, units, positions, sectors, regions, organization relationships and audit. Employee records, employment and assignments belong to Functional Platform / Personnel. Strategic Human Resources owns capability dimensions, talent profiles, evaluations, development and workforce planning. Neither domain copies organization master data. Responsible people are represented here by responsible position IDs.

Application code is in server/providers/organization* and server/routes/organization.ts; UI is client/pages/organization. The official NocoBase authentication and authorization plugins own sessions and permissions. The settings resource organization has independent read/update actions, with editable organization-reader and organization-maintainer permission sets. The bootstrap administrator is unrestricted; no other user is assigned automatically.

Each mutation must acquire the orgMutationLock row inside the database transaction before reading organizational state, validate references and topology, compare revision, and commit the change and orgAudit together. Preserve this ordering across all processes. Never expose these collections through unrestricted generated CRUD; callers must use the business routes.

Required seeds contain only domestic/overseas regions, the mutation lock and business permission sets. Do not insert example companies, sectors, units or positions into an installation. The user will enter real records.

Existing management code has no physical delete endpoint. Referenced structures are retired through inactive status, with a mandatory reason and retained audit. Scheduled organization reorganizations remain separate work. Personnel changes share orgMutationLock and block retirement or movement of referenced organization structures; current assignments, employment and pending/effective changes must be checked.

Deployment uses a separate Docker Compose project and PostgreSQL database. The original NocoBase alpha application and MQTT/PLC collector are unrelated services; do not alter them to deploy this ERP.
