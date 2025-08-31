# Mark Homework System - Core Services

This document describes the core services architecture for the Mark Homework System, a comprehensive AI-powered homework marking and question-solving platform.

## 🏗️ System Architecture

The system is built with a modular, service-oriented architecture that separates concerns and provides clear interfaces between components:

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   API Routes    │    │  Core Services   │    │  External APIs  │
│                 │    │                  │    │                 │
│ • mark-homework │◄──►│ • ImageProcessing│◄──►│ • Mathpix OCR   │
│ • chat         │    │ • MathpixService │    │ • OpenAI GPT    │
│ • status       │    │ • Annotation     │    │ • Gemini AI     │
└─────────────────┘    │ • Firestore      │    └─────────────────┘
                       └──────────────────┘
```

## 📁 Core Services

### 1. Image Processing Service (`services/imageProcessingService.ts`)

**Purpose**: Central orchestrator for the entire image processing pipeline.

**Key Features**:
- Multi-stage image processing workflow
- Image preprocessing with Sharp library
- OCR integration via Mathpix
- Question detection for mode switching
- Bounding box coordinate processing

**Main Methods**:
```typescript
// Process image through complete pipeline
static async processImage(imageData: string, options?: ProcessingOptions): Promise<Result<ProcessedImageResult, ImageProcessingError>>

// Get service health status
static getServiceStatus(): ServiceStatus

// Test pipeline functionality
static async testPipeline(): Promise<boolean>
```

**Processing Pipeline**:
1. **Input Validation** - Check image format and size
2. **Preprocessing** - Resize, enhance, and optimize for OCR
3. **OCR Processing** - Extract text and bounding boxes
4. **Result Processing** - Structure and validate output
5. **Question Detection** - Determine if image contains a question

### 2. Mathpix OCR Service (`services/mathpixService.ts`)

**Purpose**: High-quality OCR processing with mathematical text and LaTeX detection.

**Key Features**:
- Mathpix API integration
- Mathematical symbol recognition
- LaTeX text extraction
- Bounding box coordinates
- Confidence scoring

**Main Methods**:
```typescript
// Process image with OCR
static async processImage(imageData: string): Promise<ProcessedMathpixResult>

// Check service availability
static isAvailable(): boolean

// Validate image data
static validateImageData(imageData: string): boolean

// Test API connectivity
static async testConnectivity(): Promise<boolean>
```

**OCR Capabilities**:
- Mathematical expressions
- LaTeX formatting
- Text with coordinates
- Confidence scoring
- Error handling

### 3. Image Annotation Service (`services/imageAnnotationService.ts`)

**Purpose**: Generate SVG overlays and annotations for marked homework.

**Key Features**:
- SVG annotation generation
- Comment placement algorithms
- Text line breaking
- Boundary constraint handling
- Annotation statistics

**Main Methods**:
```typescript
// Create SVG overlay
static createSVGOverlay(annotations: Annotation[], imageDimensions: ImageDimensions): string

// Calculate optimal comment positions
static calculateCommentPosition(boundingBox: BoundingBox, imageDimensions: ImageDimensions, commentLength: number): Position

// Generate annotations from bounding boxes
static createAnnotationsFromBoundingBoxes(boundingBoxes: BoundingBox[], imageDimensions: ImageDimensions): Annotation[]
```

**Annotation Features**:
- Red comment boxes with white backgrounds
- Automatic text wrapping
- Position optimization
- Boundary validation
- SVG generation

### 4. Firestore Service (`services/firestoreService.ts`)

**Purpose**: Database operations for user progress, chat history, and results persistence.

**Key Features**:
- Chat message storage
- User progress tracking
- Marking results persistence
- User preferences
- Session management

**Main Methods**:
```typescript
// Save chat message
static async saveChatMessage(message: ChatMessage, sessionId: string): Promise<boolean>

// Save marking result
static async saveMarkingResult(userId: string, imageData: string, result: ProcessedImageResult, model: ModelType): Promise<boolean>

// Create chat session
static async createChatSession(userId: string, initialMessage?: string): Promise<string>
```

**Database Operations**:
- User authentication
- Chat history
- Progress tracking
- Result storage
- Preferences management

## ⚙️ Configuration

### AI Models Configuration (`config/aiModels.ts`)

**Purpose**: Centralized configuration for all supported AI models.

**Supported Models**:
- **ChatGPT 5**: OpenAI's latest model for comprehensive analysis
- **ChatGPT 4o**: OpenAI's GPT-4 Omni for balanced performance
- **Gemini 2.5 Pro**: Google's advanced model for mathematical accuracy

**Configuration Features**:
```typescript
// Get model configuration
export function getModelConfig(modelType: ModelType): AIModelConfig

// Get available models
export function getAvailableModels(): ModelType[]

// Validate model configuration
export function validateModelConfig(modelType: ModelType): boolean

// Get model-specific prompts
export function getModelPromptTemplate(modelType: ModelType): string
```

### Firebase Configuration (`config/firebase.ts`)

**Purpose**: Firebase service configuration and validation.

**Configuration Features**:
```typescript
// Initialize Firebase
static initialize(config?: FirebaseConfig): void

// Check service availability
static isServiceAvailable(service: 'auth' | 'firestore' | 'storage'): boolean

// Get environment-specific config
static getEnvironmentConfig(environment: 'development' | 'staging' | 'production'): FirebaseConfig
```

### LaTeX Configuration (`config/latex.ts`)

**Purpose**: MathJax setup and LaTeX rendering configuration.

**Features**:
```typescript
// Generate MathJax configuration
static generateMathJaxConfig(delimiters?: LaTeXDelimiters): MathJaxConfig

// Extract LaTeX expressions
static extractLaTeXExpressions(text: string, delimiters?: LaTeXDelimiters): LaTeXExpression[]

// Validate LaTeX syntax
static validateLaTeXExpression(expression: string): ValidationResult
```

## 🔧 Type Definitions

### Core Types (`types/index.ts`)

**Image Processing**:
- `ImageDimensions` - Width and height
- `BoundingBox` - Text location and content
- `ProcessedImageResult` - Complete OCR result

**AI Models**:
- `ModelType` - Supported AI model types
- `AIModelConfig` - Model configuration
- `AIModelResponse` - AI model output

**Chat System**:
- `ChatMessage` - Individual message
- `ChatHistory` - Conversation history
- `ChatRequest/Response` - API communication

**Error Handling**:
- `ImageProcessingError` - Image processing failures
- `OCRServiceError` - OCR service issues
- `AIServiceError` - AI model errors

## 🚀 Usage Examples

### Basic Image Processing

```typescript
import { ImageProcessingService } from './services/imageProcessingService';

// Process homework image
const result = await ImageProcessingService.processImage(imageData, {
  enablePreprocessing: true,
  maxImageSize: 2048,
  compressionQuality: 80
});

if (result.success) {
  const processedImage = result.data;
  console.log('OCR Text:', processedImage.ocrText);
  console.log('Bounding Boxes:', processedImage.boundingBoxes);
  console.log('Is Question:', processedImage.isQuestion);
}
```

### OCR Processing

```typescript
import { MathpixService } from './services/mathpixService';

// Check service availability
if (MathpixService.isAvailable()) {
  const ocrResult = await MathpixService.processImage(imageData);
  console.log('Extracted Text:', ocrResult.text);
  console.log('Confidence:', ocrResult.confidence);
}
```

### Annotation Generation

```typescript
import { ImageAnnotationService } from './services/imageAnnotationService';

// Create annotations from OCR results
const annotations = ImageAnnotationService.createAnnotationsFromBoundingBoxes(
  boundingBoxes,
  imageDimensions
);

// Generate SVG overlay
const svgOverlay = ImageAnnotationService.createSVGOverlay(
  annotations,
  imageDimensions
);
```

## 🧪 Testing

### TypeScript Compilation

```bash
# Check types without compilation
npm run type-check

# Compile TypeScript to JavaScript
npm run build

# Watch mode for development
npm run build:watch
```

### Service Testing

```typescript
// Test image processing pipeline
const pipelineWorking = await ImageProcessingService.testPipeline();

// Test Mathpix connectivity
const mathpixAvailable = await MathpixService.testConnectivity();

// Test Firestore connectivity
const firestoreAvailable = await FirestoreService.testConnectivity();
```

## 🔒 Environment Variables

Required environment variables for full functionality:

```bash
# Mathpix OCR
MATHPIX_API_KEY=your_mathpix_api_key

# OpenAI
OPENAI_API_KEY=your_openai_api_key

# Firebase (optional)
FIREBASE_API_KEY=your_firebase_api_key
FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
FIREBASE_PROJECT_ID=your_project_id
FIREBASE_STORAGE_BUCKET=your_project.appspot.com
FIREBASE_MESSAGING_SENDER_ID=your_sender_id
FIREBASE_APP_ID=your_app_id
```

## 📊 Service Status

Each service provides status information:

```typescript
// Image Processing Service
const status = ImageProcessingService.getServiceStatus();
// Returns: { available, mathpixAvailable, preprocessingEnabled, annotationEnabled }

// Mathpix Service
const status = MathpixService.getServiceStatus();
// Returns: { available, configured, apiKeyPresent }

// Firebase Service
const status = FirebaseConfigService.getServiceStatus();
// Returns: { configured, initialized, auth, firestore, storage }
```

## 🚧 Development Notes

### Current Limitations

1. **Image Preprocessing**: Temporarily disabled in production for stability
2. **Firebase Integration**: Mock implementation for development
3. **AI Model Integration**: Configuration ready, implementation pending
4. **Error Handling**: Basic error types defined, comprehensive handling pending

### Future Enhancements

1. **Real-time Processing**: WebSocket support for live updates
2. **Batch Processing**: Multiple image support
3. **Advanced AI**: Custom model fine-tuning
4. **Performance**: Caching and optimization
5. **Security**: Rate limiting and authentication

### Contributing

1. Follow TypeScript strict mode
2. Maintain comprehensive JSDoc comments
3. Add tests for new functionality
4. Update this documentation
5. Follow the established error handling patterns

## 📚 Additional Resources

- [Sharp Image Processing](https://sharp.pixelplumbing.com/)
- [Mathpix API Documentation](https://docs.mathpix.com/)
- [Firebase Admin SDK](https://firebase.google.com/docs/admin)
- [MathJax Documentation](https://docs.mathjax.org/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)

---

*This documentation is maintained as part of the Mark Homework System core services. For questions or contributions, please refer to the project repository.*
