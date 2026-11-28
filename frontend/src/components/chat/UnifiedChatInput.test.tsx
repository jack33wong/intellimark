import React from 'react';
import '@testing-library/jest-dom';
import { render, fireEvent, waitFor, screen, act } from '@testing-library/react';
import UnifiedChatInput from './UnifiedChatInput';

jest.mock('react-router-dom', () => ({
  useNavigate: () => jest.fn(),
  useLocation: () => ({ pathname: '/app', search: '' }),
}));

jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { uid: 'test-user', displayName: 'Test User' } }),
}));

jest.mock('../../contexts/MarkingPageContext', () => ({
  useMarkingPage: () => ({
    onGenerateModelAnswer: jest.fn(),
    isModelAnswerMode: false,
    setIsModelAnswerMode: jest.fn(),
    isMarkingSchemeMode: false,
    setIsMarkingSchemeMode: jest.fn(),
    onExplainMarkingScheme: jest.fn(),
    initialInput: '',
    setInitialInput: jest.fn(),
    showModelAnswerConfirmation: false,
    setShowModelAnswerConfirmation: jest.fn(),
    pendingModelAnswerPaper: null,
    setPendingModelAnswerPaper: jest.fn(),
    pendingConfirmationMode: null,
    setPendingConfirmationMode: jest.fn(),
  }),
}));

jest.mock('../../contexts/ModelContext', () => ({
  useModels: () => ({ defaultModel: 'gemini-2.5-pro' }),
}));

jest.mock('../../hooks/useSubscription', () => ({
  useSubscription: () => ({ checkPermission: () => true }),
}));

jest.mock('../../hooks/useTelemetry', () => ({
  useTelemetry: () => ({ logEvent: jest.fn() }),
}));

jest.mock('../../services/configService', () => ({
  __esModule: true,
  default: {
    getExamMetadata: jest.fn().mockResolvedValue({
      boards: [],
      qualifications: [],
      tiers: [],
      papers: [],
      codes: [],
    }),
  },
}));

jest.mock('../../services/MobileUploadService', () => ({
  mobileUploadService: {
    generateSessionId: jest.fn(() => 'sess-1'),
    createSession: jest.fn(),
    listenToSession: jest.fn(() => jest.fn()),
    resetSession: jest.fn(),
    cleanupSession: jest.fn(),
  },
}));

jest.mock('../../utils/funnelTracker', () => ({
  trackFunnelEvent: jest.fn(),
  getLatestPreInspectSessionId: jest.fn(() => null),
  setLatestPreInspectSessionId: jest.fn(),
}));

jest.mock('../../services/preInspectService', () => ({
  preInspectUploadedFiles: jest.fn().mockResolvedValue(null),
  recomputePreInspectFromSummaries: jest.fn(() => null),
  setPendingPreInspectContext: jest.fn(),
}));

jest.mock('browser-image-compression', () => jest.fn((file) => Promise.resolve(file)));
jest.mock('heic2any', () => ({
  __esModule: true,
  default: jest.fn(() => Promise.resolve(new Blob([new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0])], { type: 'image/jpeg' }))),
}));

jest.mock('../common/LandingPageUploadWidget', () => () => null);
jest.mock('../upload/MobileUploadModal', () => () => null);
jest.mock('../common/ImageModeModal', () => () => null);
jest.mock('../common/ConfirmationModal', () => () => null);
jest.mock('./FileHandoff', () => ({ FileHandoff: () => null }));
jest.mock('../focused', () => ({
  ModelSelector: () => <div data-testid="model-selector" />,
  SendButton: ({ onClick, disabled }: { onClick: () => void; disabled: boolean }) => (
    <button data-testid="send-button" onClick={onClick} disabled={disabled}>
      Send
    </button>
  ),
}));

const renderInput = (overrides: Partial<React.ComponentProps<typeof UnifiedChatInput>> = {}) => {
  const props: React.ComponentProps<typeof UnifiedChatInput> = {
    mode: 'first-time',
    selectedModel: 'gemini-2.5-pro',
    isProcessing: false,
    onModelChange: jest.fn(),
    onAnalyzeImage: jest.fn().mockResolvedValue(true),
    onFollowUpImage: jest.fn().mockResolvedValue(true),
    onSendMessage: jest.fn().mockResolvedValue(true),
    onAnalyzeMultiImage: jest.fn().mockResolvedValue(true),
    onFollowUpMultiImage: jest.fn().mockResolvedValue(true),
    ...overrides,
  };
  return { ...render(<UnifiedChatInput {...props} />), props };
};

const createMockFile = (name: string, type = '', size = 1024): File => {
  const content = new Uint8Array(size);
  if (/\.pdf$/i.test(name) || type === 'application/pdf') {
    content.set([0x25, 0x50, 0x44, 0x46, 0x2D]); // %PDF-
  } else if (/\.png$/i.test(name) || type === 'image/png') {
    content.set([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  } else if (/\.(jpe?g)$/i.test(name) || type === 'image/jpeg') {
    content.set([0xFF, 0xD8, 0xFF, 0xE0]);
  }
  return new File([content], name, { type, lastModified: 1700000000000 });
};

describe('UnifiedChatInput — Multi-File Finder Paste, Local Path Interception & Drag-and-Drop', () => {
  let originalFileReader: typeof FileReader;

  beforeEach(() => {
    const ConfigService = require('../../services/configService').default;
    ConfigService.getExamMetadata.mockResolvedValue({
      boards: [],
      qualifications: [],
      tiers: [],
      papers: [],
      codes: [],
    });
    const imageCompression = require('browser-image-compression');
    imageCompression.mockImplementation((file: File) => Promise.resolve(file));
    const { mobileUploadService } = require('../../services/MobileUploadService');
    mobileUploadService.generateSessionId.mockReturnValue('sess-1');
    mobileUploadService.createSession.mockResolvedValue(undefined);
    mobileUploadService.listenToSession.mockReturnValue(jest.fn());

    originalFileReader = window.FileReader;
    class MockFileReader {
      result: string | ArrayBuffer | null = 'data:image/jpeg;base64,MOCK';
      onload: ((this: FileReader, ev: ProgressEvent<FileReader>) => any) | null = null;
      onerror: ((this: FileReader, ev: ProgressEvent<FileReader>) => any) | null = null;
      readAsDataURL() {
        this.result = 'data:image/jpeg;base64,MOCK';
        if (this.onload) {
          this.onload.call(this as unknown as FileReader, {} as ProgressEvent<FileReader>);
        }
      }
      readAsArrayBuffer(blob: Blob) {
        const nativeReader = new originalFileReader();
        nativeReader.onload = () => {
          this.result = nativeReader.result;
          if (this.onload) {
            this.onload.call(this as unknown as FileReader, {} as ProgressEvent<FileReader>);
          }
        };
        nativeReader.onerror = (ev) => {
          if (this.onerror) {
            this.onerror.call(this as unknown as FileReader, ev);
          }
        };
        nativeReader.readAsArrayBuffer(blob);
      }
    }
    (window as any).FileReader = MockFileReader;
  });

  afterEach(() => {
    window.FileReader = originalFileReader;
    jest.clearAllMocks();
  });

  test('pastes 14 .JPG files from clipboardData.files (with empty MIME type) and calls preventDefault', async () => {
    const { container } = renderInput();
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;

    const files = Array.from({ length: 14 }, (_, i) =>
      createMockFile(`IMG_${String(i + 1).padStart(4, '0')}.JPG`, '', 5000)
    );

    const pasteEvent = new Event('paste', { bubbles: true, cancelable: true }) as any;
    pasteEvent.clipboardData = {
      files,
      items: [],
      getData: () => '',
    };

    await act(async () => {
      fireEvent(textarea, pasteEvent);
    });

    expect(pasteEvent.defaultPrevented).toBe(true);
    expect(textarea.value).toBe('');

    await waitFor(() => {
      expect(container.querySelectorAll('.attachment-tile.image-tile').length).toBe(14);
    });
  });

  test('pastes files from clipboardData.items when item.type is empty (.JPG) and deduplicates against clipboardData.files', async () => {
    const { container } = renderInput();
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;

    const file1 = createMockFile('PHOTO_1.JPG', '', 2048);
    const file2 = createMockFile('PHOTO_2.JPG', '', 4096);

    const pasteEvent = new Event('paste', { bubbles: true, cancelable: true }) as any;
    pasteEvent.clipboardData = {
      files: [file1],
      items: [
        { kind: 'file', type: '', getAsFile: () => file1 },
        { kind: 'file', type: '', getAsFile: () => file2 },
      ],
      getData: () => '',
    };

    await act(async () => {
      fireEvent(textarea, pasteEvent);
    });

    expect(pasteEvent.defaultPrevented).toBe(true);
    await waitFor(() => {
      expect(container.querySelectorAll('.attachment-tile.image-tile').length).toBe(2);
    });
  });

  test('intercepts macOS Finder local file paths in text/plain when clipboard files are blocked', async () => {
    const { container } = renderInput();
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;

    const rawPaths = [
      '/Users/ytwong/Downloads/IMG_0001.JPG',
      '/Users/ytwong/Downloads/IMG_0002.JPG',
      '/Users/ytwong/Downloads/IMG_0003.JPG',
    ].join('\n');

    const pasteEvent = new Event('paste', { bubbles: true, cancelable: true }) as any;
    pasteEvent.clipboardData = {
      files: [],
      items: [],
      getData: (type: string) => (type === 'text/plain' ? rawPaths : ''),
    };

    await act(async () => {
      fireEvent(textarea, pasteEvent);
    });

    expect(pasteEvent.defaultPrevented).toBe(true);
    expect(textarea.value).toBe('');
    expect(
      screen.getByText(/Browser security prevents pasting local file paths directly/i)
    ).toBeInTheDocument();
  });

  test('intercepts Windows, Linux, and file:/// local file paths in text/plain', async () => {
    const { container } = renderInput();
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;

    for (const path of [
      'C:\\Users\\student\\Downloads\\page1.pdf',
      '/home/student/scans/essay.png',
      'file:///Users/student/Desktop/work.heic',
    ]) {
      const pasteEvent = new Event('paste', { bubbles: true, cancelable: true }) as any;
      pasteEvent.clipboardData = {
        files: [],
        items: [],
        getData: (type: string) => (type === 'text/plain' ? path : ''),
      };

      await act(async () => {
        fireEvent(textarea, pasteEvent);
      });

      expect(pasteEvent.defaultPrevented).toBe(true);
    }
  });

  test('allows normal text paste without interception', async () => {
    const { container } = renderInput();
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;

    const pasteEvent = new Event('paste', { bubbles: true, cancelable: true }) as any;
    pasteEvent.clipboardData = {
      files: [],
      items: [],
      getData: () => 'Edexcel 1MA1/2H June 2022',
    };

    await act(async () => {
      fireEvent(textarea, pasteEvent);
    });

    expect(pasteEvent.defaultPrevented).toBe(false);
    expect(
      screen.queryByText(/Browser security prevents pasting local file paths directly/i)
    ).not.toBeInTheDocument();
  });

  test('supports drag-and-drop for multiple .JPG and .pdf files with drag-over visual state', async () => {
    const { container } = renderInput();
    const dropZone = container.querySelector('.followup-single-line-container') as HTMLDivElement;

    await act(async () => {
      fireEvent.dragEnter(dropZone, { dataTransfer: { files: [] } });
    });
    expect(dropZone.classList.contains('drag-over')).toBe(true);

    // Nested dragEnter + dragLeave should keep drag-over active until outer dragLeave
    await act(async () => {
      fireEvent.dragEnter(dropZone, { dataTransfer: { files: [] } });
      fireEvent.dragLeave(dropZone, { dataTransfer: { files: [] } });
    });
    expect(dropZone.classList.contains('drag-over')).toBe(true);

    const droppedFiles = [
      createMockFile('PAGE_1.JPG', '', 4096),
      createMockFile('MARK_SCHEME.pdf', 'application/pdf', 8192),
    ];

    await act(async () => {
      fireEvent.drop(dropZone, {
        dataTransfer: { files: droppedFiles },
      });
    });

    expect(dropZone.classList.contains('drag-over')).toBe(false);
    await waitFor(() => {
      expect(container.querySelectorAll('.attachment-tile.image-tile').length).toBe(1);
      expect(container.querySelectorAll('.attachment-tile.pdf-tile').length).toBe(1);
    });
  });

  test('shows warning when dropping only unsupported files', async () => {
    const { container } = renderInput();
    const dropZone = container.querySelector('.followup-single-line-container') as HTMLDivElement;

    const unsupported = [createMockFile('notes.txt', 'text/plain', 512)];
    await act(async () => {
      fireEvent.drop(dropZone, {
        dataTransfer: { files: unsupported },
      });
    });

    expect(
      screen.getByText(/Only image files \(JPG, PNG, WEBP, HEIC, etc\.\) and PDFs are supported\./i)
    ).toBeInTheDocument();
  });

  test('ignores paste and drop when isProcessing or isNegative is true', async () => {
    for (const override of [{ isProcessing: true }, { isNegative: true }]) {
      const { container, unmount } = renderInput(override);
      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      const dropZone = container.querySelector('.followup-single-line-container') as HTMLDivElement;

      const file = createMockFile('IMG_1.JPG', '', 2048);
      const pasteEvent = new Event('paste', { bubbles: true, cancelable: true }) as any;
      pasteEvent.clipboardData = {
        files: [file],
        items: [],
        getData: () => '',
      };

      await act(async () => {
        fireEvent(textarea, pasteEvent);
        fireEvent.dragEnter(dropZone, { dataTransfer: { files: [] } });
        fireEvent.drop(dropZone, { dataTransfer: { files: [file] } });
      });

      expect(pasteEvent.defaultPrevented).toBe(false);
      expect(dropZone.classList.contains('drag-over')).toBe(false);
      expect(container.querySelectorAll('.attachment-tile.image-tile').length).toBe(0);
      expect(container.querySelectorAll('.followup-preview-image').length).toBe(0);
      unmount();
    }
  });

  test('filters out unsupported files when dropping a mixed batch', async () => {
    const { container } = renderInput();
    const dropZone = container.querySelector('.followup-single-line-container') as HTMLDivElement;

    const mixed = [
      createMockFile('notes.txt', 'text/plain', 512),
      createMockFile('PAGE_1.JPG', '', 2048),
      createMockFile('PAGE_2.PNG', '', 2048),
      createMockFile('PAGE_3.HEIC', '', 2048),
    ];

    await act(async () => {
      fireEvent.drop(dropZone, { dataTransfer: { files: mixed } });
    });

    await waitFor(() => {
      expect(container.querySelectorAll('.attachment-tile.image-tile').length).toBe(2);
    });
  });

  test('renders context-chip-container in mode="follow-up" when contextQuestionId is set', () => {
    const { container } = renderInput({ mode: 'follow-up', contextQuestionId: '3' });
    expect(container.querySelector('.context-chip-container')).toBeInTheDocument();
    expect(screen.getByText('Question 3 Focused')).toBeInTheDocument();
    expect(screen.getByText('AUTO')).toBeInTheDocument();
  });

  test('does not render context-chip-container in mode="first-time" even if contextQuestionId is provided', () => {
    const { container } = renderInput({ mode: 'first-time', contextQuestionId: '3' });
    expect(container.querySelector('.context-chip-container')).not.toBeInTheDocument();
    expect(screen.queryByText('Question 3 Focused')).not.toBeInTheDocument();
  });

  test('tracks file_attached when a valid file is selected via file input', async () => {
    const { trackFunnelEvent } = require('../../utils/funnelTracker');
    const { container } = renderInput();
    const fileInput = container.querySelector('#unified-file-input') as HTMLInputElement;

    // Minimal valid JPEG magic bytes (FF D8 FF E0)
    const jpegBytes = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]);
    const validJpeg = new File([jpegBytes], 'homework.jpg', { type: 'image/jpeg' });

    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [validJpeg] } });
    });

    await waitFor(() => {
      expect(trackFunnelEvent).toHaveBeenCalledWith(
        'file_attached',
        expect.objectContaining({
          source: 'unified_chat_input',
          mode: 'first-time',
          fileCount: 1,
          totalFileCount: 1,
        }),
        'test-user'
      );
    });
  });

  test('auto-converts a valid HEIC file to JPEG and tracks file_attached', async () => {
    const { trackFunnelEvent } = require('../../utils/funnelTracker');
    const heic2any = require('heic2any').default;
    heic2any.mockResolvedValueOnce(
      new Blob([new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10])], { type: 'image/jpeg' })
    );

    const { container } = renderInput();
    const fileInput = container.querySelector('#unified-file-input') as HTMLInputElement;

    // Real ISO BMFF ftyp + 'heic' brand header (bytes 4..11)
    const heicBytes = new Uint8Array([
      0x00, 0x00, 0x00, 0x18,
      0x66, 0x74, 0x79, 0x70, // 'ftyp'
      0x68, 0x65, 0x69, 0x63, // 'heic'
      0x00, 0x00, 0x00, 0x00,
    ]);
    const heicFile = new File([heicBytes], 'IMG_0001.heic', { type: 'image/heic' });

    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [heicFile] } });
    });

    await waitFor(() => {
      expect(trackFunnelEvent).toHaveBeenCalledWith(
        'file_attached',
        expect.objectContaining({
          source: 'unified_chat_input',
          mode: 'first-time',
          fileCount: 1,
          totalFileCount: 1,
          fileTypes: ['image/jpeg'],
        }),
        'test-user'
      );
    });
  });

  test('accepts a PDF with leading BOM/whitespace before %PDF- header', async () => {
    const { trackFunnelEvent } = require('../../utils/funnelTracker');
    const { container } = renderInput();
    const fileInput = container.querySelector('#unified-file-input') as HTMLInputElement;

    const pdfWithLeadingBytes = new Uint8Array([
      0xEF, 0xBB, 0xBF, 0x20, 0x0A, // UTF-8 BOM + whitespace
      0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x37, // %PDF-1.7
    ]);
    const pdfFile = new File([pdfWithLeadingBytes], 'scan.pdf', { type: 'application/pdf' });

    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [pdfFile] } });
    });

    await waitFor(() => {
      expect(trackFunnelEvent).toHaveBeenCalledWith(
        'file_attached',
        expect.objectContaining({
          source: 'unified_chat_input',
          mode: 'first-time',
          fileCount: 1,
          fileTypes: ['application/pdf'],
        }),
        'test-user'
      );
    });
  });

  test('tracks client_file_rejected when an unsupported or empty file is selected via file input', async () => {
    const { trackFunnelEvent } = require('../../utils/funnelTracker');
    const { container } = renderInput();
    const fileInput = container.querySelector('#unified-file-input') as HTMLInputElement;

    // ZIP/DOCX magic bytes (PK\x03\x04)
    const docxBytes = new Uint8Array([0x50, 0x4B, 0x03, 0x04, 0x14, 0x00]);
    const unsupportedFile = new File(
      [docxBytes],
      'essay.docx',
      { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }
    );

    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [unsupportedFile] } });
    });

    await waitFor(() => {
      expect(trackFunnelEvent).toHaveBeenCalledWith(
        'client_file_rejected',
        expect.objectContaining({
          source: 'unified_chat_input',
          mode: 'first-time',
          reason: 'unsupported_format',
          fileName: 'essay.docx',
        }),
        'test-user'
      );
    });
  });

  test('tracks client_file_rejected when dropping only unsupported files', async () => {
    const { trackFunnelEvent } = require('../../utils/funnelTracker');
    const { container } = renderInput();
    const dropZone = container.querySelector('.followup-single-line-container') as HTMLDivElement;

    const unsupported = [createMockFile('essay.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 2048)];
    await act(async () => {
      fireEvent.drop(dropZone, {
        dataTransfer: { files: unsupported },
      });
    });

    expect(trackFunnelEvent).toHaveBeenCalledWith(
      'client_file_rejected',
      expect.objectContaining({
        source: 'unified_chat_input',
        mode: 'first-time',
        reason: 'unsupported_drop_format',
        fileName: 'essay.docx',
      }),
      'test-user'
    );
  });

  test('disables Send button when pre-inspect flags file as invalid, but allows explicit "mark anyway" override', async () => {
    const { preInspectUploadedFiles } = require('../../services/preInspectService');
    preInspectUploadedFiles.mockResolvedValueOnce({
      preInspectToken: 'tok-invalid',
      preInspectSessionId: 'pi-invalid-1',
      overallStatus: 'invalid',
      docType: 'non_academic',
      isWarning: true,
      bannerTitle: 'Not an academic exam or homework image',
      suggestions: [{ id: 'replace', label: 'Replace with a homework photo', action: 'replace_file' }],
      perFileRoles: [{ fileName: 'screenshot.jpg', role: 'non_academic', pageCount: 1, sampledPages: [0] }],
    });

    const { container, props } = renderInput();
    const fileInput = container.querySelector('#unified-file-input') as HTMLInputElement;

    const jpegBytes = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]);
    const file = new File([jpegBytes], 'screenshot.jpg', { type: 'image/jpeg' });

    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } });
    });

    await waitFor(() => {
      expect(screen.getByText('Not an academic exam or homework image')).toBeInTheDocument();
    });

    // Main Send button must be disabled so user doesn't accidentally hit auth wall or mark junk
    const sendBtn = screen.getByTestId('send-button');
    expect(sendBtn).toBeDisabled();

    // Explicit escape hatch lets user override a false-positive invalid classification
    const overrideBtn = screen.getByRole('button', { name: /This is my homework — mark anyway/i });
    await act(async () => {
      fireEvent.click(overrideBtn);
    });

    await waitFor(() => {
      expect(props.onAnalyzeImage).toHaveBeenCalledTimes(1);
    });
  });
});
