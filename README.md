# MedQuel Cloud Functions

<div align="center">

### Background processing for the MedQuel learning platform

<p>
	<a href="https://github.com/MedQuel/MedQuel-cloud-functions"><img src="https://img.shields.io/badge/repository-MedQuel--cloud--functions-1D6FE0" alt="Repository" /></a>
	<a href="https://github.com/MedQuel/MedQuel-cloud-functions/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-2EA44C" alt="Apache 2.0 license" /></a>
	<a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-24-339933" alt="Node.js 24" /></a>
</p>

</div>

MedQuel Cloud Functions contains the asynchronous workers and scheduled jobs that support the MedQuel mobile and web applications. The functions use Firebase Admin SDK, Firestore, BigQuery, Cloud Storage, Pub/Sub, Firebase Cloud Messaging, and Gemini where appropriate.

This repository is intentionally separate from the [MedQuel client](https://github.com/MedQuel/MedQuel-client) and the backend API. The API owns authenticated user-facing operations; these functions own background processing, scheduled maintenance, ingestion, notifications, and derived data updates.

## Contents

- [Architecture](#architecture)
- [Function inventory](#function-inventory)
- [Repository structure](#repository-structure)
- [Requirements](#requirements)
- [Local development](#local-development)
- [Continuous integration](#continuous-integration)
- [Configuration](#configuration)
- [GCP deployment](#gcp-deployment)
- [Current GCP resources](#current-gcp-resources)
- [Reliability and security](#reliability-and-security)
- [Pre-push checklist](#pre-push-checklist)
- [License](#license)

## Architecture

```text
MedQuel Client
			|
			v
MedQuel GraphQL API on Cloud Run
			|
			+--> Firestore and BigQuery
			+--> Pub/Sub topics
								|
								v
				Cloud Functions in this repository
```

The functions are deployed independently as second-generation Google Cloud Functions in `asia-south1`. Pub/Sub and Cloud Scheduler provide delivery and scheduling. Firestore transactions and event idempotency documents protect the main event-driven flows from duplicate delivery.

The broader system design is described in the MedQuel Backend Architecture document. This README describes the code that actually lives in this repository; planned API services, Firestore rules, indexes, payment webhooks, and other infrastructure are not implemented here.

## Function inventory

| Function                      | Trigger                     | Responsibility                                                                                                 |
| ----------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `onQuizCompleted`             | Pub/Sub                     | Updates leaderboard periods, activity logs, and user statistics after a completed quiz.                        |
| `evaluateBadges`              | Pub/Sub                     | Evaluates active badge rules and publishes notification requests for newly earned badges.                      |
| `sendNotification`            | Pub/Sub                     | Writes in-app notifications and sends FCM push notifications.                                                  |
| `ingestQuestions`             | Cloud Storage               | Parses `.xlsx` uploads, validates rows, checks image paths, deduplicates, and inserts questions into BigQuery. |
| `generateContests`            | Cloud Scheduler via Pub/Sub | Generates rotation contests from active templates.                                                             |
| `generateWeeklyChampionship`  | Cloud Scheduler via Pub/Sub | Generates the weekly grand championship contest.                                                               |
| `contestLifecycle`            | Cloud Scheduler via Pub/Sub | Activates scheduled contests and finalizes contests whose end time has passed.                                 |
| `rollupLeaderboard`           | Cloud Scheduler via Pub/Sub | Recalculates ranks and weekly deltas for active leaderboard periods.                                           |
| `checkStreaks`                | Cloud Scheduler via Pub/Sub | Resets expired streaks and removes old completed contest documents.                                            |
| `weeklyStudyPlanRegeneration` | Cloud Scheduler via Pub/Sub | Regenerates active user study plans using Gemini with a deterministic fallback.                                |

`generateContests` and `generateWeeklyChampionship` are two exported entrypoints from the `generateContests` package.

## Repository structure

Each top-level directory is an independently deployable function package:

```text
checkStreaks/
contestLifecycle/
evaluateBadges/
generateContests/          # two entrypoints
ingestQuestions/
onQuizCompleted/
rollupLeaderboard/
sendNotification/
weeklyStudyPlanRegeneration/
```

Every package contains:

- `src/` TypeScript source code
- `package.json` with its function entrypoint and scripts
- `package-lock.json` for reproducible installs
- `tsconfig.json` with strict TypeScript settings
- `.gcloudignore` to keep deployment packages small

## Requirements

- Node.js 24
- npm
- Google Cloud CLI (`gcloud`)
- Access to the `medquel-prod` GCP project
- Application Default Credentials for local Google Cloud SDK access
- Permission to use Firestore, BigQuery, Cloud Storage, Pub/Sub, and Cloud Scheduler resources

Authenticate locally when needed:

```bash
gcloud auth application-default login
gcloud config set project medquel-prod
```

Do not commit service-account JSON files. Production workloads should use the function's service account and Application Default Credentials.

## Local development

Install and build one function:

```bash
cd onQuizCompleted
npm ci
npm run build
```

Build every function from the repository root in PowerShell:

```powershell
Get-ChildItem -Directory | ForEach-Object {
	if (Test-Path (Join-Path $_.FullName 'package.json')) {
		Push-Location $_.FullName
		npm ci
		npm run build
		Pop-Location
	}
}
```

The `start` script in each package runs the Functions Framework locally. Pub/Sub and Storage handlers require a representative CloudEvent payload; scheduled functions can be invoked with a test CloudEvent.

There are currently no automated unit or integration tests. A production-quality change should add focused tests for event parsing, idempotency, date boundaries, retries, and partial failures.

## Continuous integration

GitHub Actions runs the workflow in `.github/workflows/ci.yml` for pushes to `main`, pull requests targeting `main`, and manual workflow dispatches.

The workflow builds every function package independently using Node.js 24:

1. Checks out the repository.
2. Installs the package's locked dependency tree with `npm ci`.
3. Runs `npm run build`.

The build jobs run in parallel. A pull request should not be merged until every package build passes.

## Configuration

Environment files are local deployment inputs only. `*.env.yaml` is ignored by git and must never contain committed credentials. Prefer Secret Manager for secrets.

| Package                       | Required variables                                                                      | Optional variables                                                             |
| ----------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `generateContests`            | `PROJECT_ID`, `DATASET_ID`                                                              | None                                                                           |
| `ingestQuestions`             | `PROJECT_ID`, `DATASET_ID`, `QUESTIONS_TABLE`, `BUCKET_NAME`, `FIREBASE_STORAGE_BUCKET` | `UPLOAD_PREFIX` (defaults to `incoming/`)                                      |
| `evaluateBadges`              | None                                                                                    | `PUBSUB_TOPIC_NOTIFICATIONS`                                                   |
| `weeklyStudyPlanRegeneration` | At least one of `GEMINI_API_KEY_1` or `GEMINI_API_KEY_2` for AI generation              | `GEMINI_MODEL`                                                                 |
| Other packages                | None                                                                                    | Uses Google Application Default Credentials and Firebase project configuration |

The runtime service account must have only the permissions required by each function. Typical permissions include:

- Firestore read/write access for operational collections
- BigQuery query and insert access for question ingestion and contest generation
- Cloud Storage object read access for uploaded spreadsheets and question images
- Pub/Sub subscriber or publisher access for the relevant topics
- Cloud Scheduler service-agent permission to publish scheduled trigger messages

## GCP deployment

Build from the package directory before deploying. A generic second-generation deployment looks like this:

```bash
gcloud functions deploy onQuizCompleted \
	--gen2 \
	--runtime=nodejs24 \
	--region=asia-south1 \
	--source=onQuizCompleted \
	--entry-point=onQuizCompleted \
	--trigger-topic=quiz-events
```

Use the correct trigger, service account, environment variables, and Pub/Sub topic for each function. Do not copy the example blindly into production. Verify the deployed entrypoint and trigger in the Cloud Functions console after every deployment.

## Current GCP resources

### Pub/Sub topics

```text
checkStreaks-trigger
contest-generation-tick
contest-lifecycle-tick
eventarc-asia-south1-ingestquestions-574257-739
leaderboard-rollup-tick
notification-events
quiz-events
weekly-championship-tick
weekly-studyPlan-regeneration-tick
```

The Eventarc topic is managed by Google for the Storage-triggered `ingestQuestions` function. Do not delete or publish to it manually.

### Cloud Scheduler jobs

Observed schedules, all using `Asia/Kolkata`:

| Job                                 | Observed schedule | Pub/Sub target                       |
| ----------------------------------- | ----------------- | ------------------------------------ |
| `checkStreaks-daily`                | `5 0 * * *`       | `checkStreaks-trigger`               |
| `contest-lifecycle-tick`            | `*/15 * * * *`    | `contest-lifecycle-tick`             |
| `generate-contests-tick`            | `0 */4 * * *`     | `contest-generation-tick`            |
| `generate-weekly-championship-tick` | `0 0 * * 1`       | `weekly-championship-tick`           |
| `rollup-leaderboard-tick`           | `*/2 * * * *`     | `leaderboard-rollup-tick`            |
| `weekly-studyPlan-regeneration-job` | `0 23 * * 0`      | `weekly-studyPlan-regeneration-tick` |

The deployed schedule is authoritative. Keep it synchronized with code documentation and verify timezone assumptions when changing schedules.

## Reliability and security

Before production deployment, address these known concerns:

1. Contest finalization currently claims a contest before ranking and bonus work has fully completed. A later failure can leave a contest marked completed without a resumable finalization.
2. Some scheduled handlers log errors without rethrowing them. That makes Cloud Scheduler report success and prevents Pub/Sub retry behavior.
3. Contest template generation claims `lastGeneratedAt` before generation completes. A failed generation can delay the next attempt.
4. Push notification errors are currently logged as best effort. Decide explicitly whether failed pushes should be retried.
5. Validate complete Pub/Sub event schemas, not only `sessionId` and `userId`, before applying numeric increments or derived statistics.
6. Add Firestore indexes, security rules, IAM bindings, alerting, and dead-letter topics as deployment-managed infrastructure rather than relying on console state.

Never place Gemini keys, service-account credentials, payment secrets, or private deployment configuration in this repository. Rotate any credential that has ever been committed or shared outside Secret Manager.

## License

MedQuel Cloud Functions is licensed under the Apache License 2.0. See [LICENSE](LICENSE).

<div align="center">
Build with ❤️ by Team GrayCode.
</div>
