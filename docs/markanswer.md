### Mark Homework with Answer — Service-Level Flow

```text
[MarkHomeworkController]
  |
  v
[RequestValidator] --Zod/Joi--> [ValidatedRequest]
  |
  v
[MarkHomeworkWithAnswer (Use Case Orchestrator)]
  |
  +--> [ImageIngestService]
  |        - normalize uploads (base64/url) -> temp URIs
  |        - optional persist originals via ImageStorageService
  |
  +--> [HybridOCRService]
  |        - Google Vision + Mathpix/MyScript merge
  |        - outputs questionText, studentWorkBlocks, artifacts, apiUsed
  |
  +--> [QuestionDetectionService]
  |        - detect exam/question; confidence & references
  |
  +--> [MarkingSchemeRepository]
  |        - fetch scheme by detection result (steps, rubric, totalMarks)
  |
  +--> [AnswerExtractionService]
  |        - prefer providedAnswerText else consolidate OCR student blocks
  |
  +--> [AIMarkingService]
  |        - compare studentAnswer vs scheme
  |        - produce score, per-step feedback, rationale, apiUsed
  |
  +--> [SvgOverlayService]
  |        - build overlays from OCR blocks + feedback mappings
  |
  +--> [ResultAssembler]
  |        - normalize response DTO, include detection + reasoning
  |
  +--> [SessionWriter (FirestoreService)]
  |        - persist session, artifacts, messages, errors
  |
  v
[HTTP Response DTO]
```

### Supporting Adapters and Infra
- **ImageStorageService**: signed URLs; configured in `config/imageStorage.ts`.
- **ModelProviderRegistry**: AI model routing via `config/aiModels.ts`.
- **FirestoreService**: session and result persistence.
- **SubscriptionService / SubscriptionDelayService**: gating before AI when required.
- **Logger/Tracing**: structured logs; propagate `requestId` and `sessionId`.
- **ErrorMapper**: map domain errors → HTTP status and codes.

### Data Contracts (high-level)
- **OCRResult**: `questionText?`, `studentWorkBlocks[]`, `artifacts`, `apiUsed`.
- **QuestionDetection**: `match?`, `confidence`, exam metadata.
- **MarkingScheme**: `steps[]`, `totalMarks`, `rubric?`.
- **MarkingResult**: `score`, `outOf`, `perStep[]`, `rationale`, `apiUsed`.
- **OverlayArtifacts**: `svgs[]`, `boxes[]`.
- **SessionRecord**: request metadata, artifacts, messages, result.


