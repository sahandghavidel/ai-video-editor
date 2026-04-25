# Ultimate Video Editor - AI-Powered Video Production Pipeline

A comprehensive Next.js application for automated video content creation with integrated TTS (Text-to-Speech), video synchronization, and intelligent automation features.

## 🚀 Key Features

### Core Functionality

- **Baserow Integration**: Full CRUD operations with self-hosted Baserow database
- **Inline Text Editing**: Click-to-edit interface with real-time database updates
- **TTS Generation**: AI-powered text-to-speech with MinIO cloud storage integration
- **Video Processing**: Local FFmpeg-based video processing with hardware acceleration
- **Transcription**: High-quality NVIDIA Parakeet TDT model for speech-to-text
- **Smart Automation**: Optional auto-generation workflows for streamlined production
- **Media Playback**: Integrated audio/video players with modal interfaces
- **File Management**: Centralized MinIO object storage for all media assets

### Advanced Automation Options

- **Auto-Generate TTS**: Automatically create audio when text is saved
- **Auto-Generate Videos**: Automatically synchronize videos after TTS creation
- **Smart Workflow**: Chain TTS → Video → Production pipeline seamlessly

## 📚 Internal Documentation

- [Batch Operations Guide](docs/Batch-Operations-Guide.md) - How batch actions are structured and how to add new ones (including Telegram completion notifications)
- [FFmpeg Fonts (macOS)](docs/FFMPEG-Fonts.md) - Deterministic `drawtext` font usage and local font inventory

## 🏗️ Architecture Overview

### Production Pipeline

```
Text Edit → TTS Generation → Video Synchronization → Final Production
     ↓            ↓                    ↓                    ↓
Baserow      MinIO Storage      Local FFmpeg        Playback Ready
field_6890   field_6891         field_6886          Media Players
```

### Service Integration

- **Baserow Database**: `host.docker.internal:714` - Data persistence
- **TTS Service**: `host.docker.internal:8004` - Speech synthesis
- **MinIO Storage**: `host.docker.internal:9000` - File storage
- **Parakeet Transcription**: Local NVIDIA model for speech-to-text
- **Next.js App**: `localhost:3000` - User interface

## Tech Stack

- **Frontend**: Next.js 15, React, TypeScript, Tailwind CSS
- **Database**: Baserow (self-hosted at host.docker.internal:714)
- **Storage**: MinIO object storage (host.docker.internal:9000)
- **Audio Processing**: Custom TTS service (host.docker.internal:8004)
- **Video Processing**: Local FFmpeg with hardware acceleration
- **Transcription**: NVIDIA Parakeet TDT 0.6B v3 model
- **Authentication**: JWT tokens for Baserow API

## 🎛️ User Interface

### Interactive Scene Cards

Each scene provides a complete production interface with:

#### Media Control Buttons:

1. **🎵 Generate TTS** (Purple) - Create AI speech from text
2. **🔊 Play Audio** (Blue) - Preview generated TTS audio
3. **🎬 Play Video** (Green) - View original video clip
4. **⚡ Generate Video** (Teal) - Synchronize audio with video
5. **🎯 Play Produced** (Orange) - Preview final synchronized video

#### Automation Controls:

- **Auto-Generate TTS**: Checkbox to enable automatic TTS creation on text save
- **Auto-Generate Videos**: Checkbox to enable automatic video sync after TTS generation

### Smart Workflow Features

- **Click-to-Edit**: Inline text editing with auto-save to database
- **Optimistic Updates**: Immediate UI feedback with server synchronization
- **Error Handling**: Graceful error recovery with user notifications
- **Loading States**: Visual feedback during processing operations
- **Responsive Design**: Mobile-friendly interface with Tailwind CSS

## 🔧 Technical Implementation

### API Routes

```typescript
/api/generate-tts    # TTS generation + MinIO upload
/api/generate-video  # Video synchronization via local FFmpeg
```

### Database Schema (Baserow Fields)

- `field_6890`: Scene text content
- `field_6888`: Original video URL
- `field_6891`: Generated TTS audio URL
- `field_6886`: Synchronized video URL
- `order`: Scene ordering

### Video Synchronization Algorithm

```javascript
// Local FFmpeg processing with duration-based speed adjustment
const speedRatio = videoDuration / audioDuration;
const syncedVideo = await processVideoWithAudio({
  originalVideo: videoUrl,
  audioTrack: audioUrl,
  speedAdjustment: speedRatio,
  outputFormat: 'mp4',
});
```

### Component Architecture

```typescript
SceneCard.tsx           # Main component with 5-button interface
├── State Management    # React hooks for UI state
├── Media Refs         # useRef for audio/video elements
├── API Integration    # Fetch calls to generation endpoints
├── Auto-generation    # Conditional workflow automation
└── Error Handling     # Graceful failure recovery
```

## 📦 Project Structure

```
src/
├── app/
│   ├── page.tsx                    # Main dashboard
│   └── api/
│       ├── generate-tts/route.ts   # TTS + MinIO integration
│       └── generate-video/route.ts # Local FFmpeg processing
├── components/
│   └── SceneCard.tsx              # Production interface
└── lib/
    └── baserow-actions.ts         # Database operations
```

## ⚙️ Configuration & Setup

### 1. Environment Configuration

Create a `.env.local` file in the root directory with your Baserow configuration:

**For Self-Hosted Baserow:**

```env
# Baserow API Configuration (Self-hosted)
BASEROW_API_URL=http://host.docker.internal/api
BASEROW_EMAIL=your_email@example.com
BASEROW_PASSWORD=your_password
BASEROW_TABLE_ID=your_table_id_here
```

**For Baserow Cloud:**

```env
# Baserow API Configuration (Cloud)
BASEROW_API_URL=https://api.baserow.io/api
BASEROW_EMAIL=your_email@example.com
BASEROW_PASSWORD=your_password
BASEROW_TABLE_ID=your_table_id_here
```

### 2. Getting Your Baserow Credentials

#### Email and Password

Use your Baserow account login credentials. The application will authenticate using JWT tokens.

#### Table ID

1. Open your Baserow table in the browser
2. Look at the URL: `http://your-baserow-host/database/{database_id}/table/{table_id}`
3. Copy the `table_id` number to your `.env.local` file

### 3. Install Dependencies

```bash
npm install
```

### 4. Run the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the application.

## Project Structure

```
src/
├── app/
│   └── page.tsx              # Main dashboard page
├── components/
│   ├── DataTable.tsx         # Table component for displaying data
│   └── AddDataForm.tsx       # Form component for adding new data
└── lib/
    └── baserow-actions.ts    # Server actions for Baserow API
```

## 🧠 AI & Processing Services

### TTS Service Integration

- **Endpoint**: `POST http://host.docker.internal:8004/generate-speech`
- **Features**: High-quality AI speech synthesis
- **Output**: WAV audio files uploaded to MinIO storage
- **Storage**: Automatic MinIO bucket management

### Parakeet Transcription Service

- **Model**: NVIDIA Parakeet TDT 0.6B v3
- **Features**: High-quality speech-to-text with automatic punctuation
- **Output**: Word-level timestamps and segment organization
- **Language**: Multilingual support (25 European languages)

### Local FFmpeg Processing

- **Capabilities**: Hardware-accelerated video processing
- **Features**: Trimming, speed adjustment, concatenation, synchronization
- **Algorithm**: Duration-ratio speed adjustment for perfect sync

### MinIO Object Storage

- **Bucket**: `nca-toolkit` for centralized media storage
- **Access**: HTTP URLs for direct media playback
- **Management**: Automatic cleanup and organization

## 🔄 Workflow Automation

### Manual Mode

1. Edit scene text
2. Click "Generate TTS" → Audio created and stored
3. Click "Generate Video" → Video synchronized with audio
4. Click "Play Produced" → Preview final result

### Automated Mode

1. Enable "Auto-Generate TTS" checkbox
2. Enable "Auto-Generate Videos" checkbox
3. Edit scene text → Entire pipeline executes automatically
4. Final video ready for playback

## 🚦 Production Features

### Real-time Processing

- **Optimistic UI Updates**: Immediate visual feedback
- **Background Processing**: Non-blocking operations
- **Progress Indicators**: Loading states for all operations
- **Error Recovery**: Automatic rollback on failures

### Media Management

- **Centralized Storage**: All files in MinIO object storage
- **URL Management**: Automatic URL generation and storage
- **File Cleanup**: Organized bucket structure
- **Direct Playback**: No download required for media preview

## 🐳 Docker Services Required

### Service Stack

```yaml
# Required services for full functionality
services:
  baserow: # Database and UI
    port: 714
  tts-service: # AI speech synthesis
    port: 8004
  parakeet-env: # Transcription environment
    python: local
  local-ffmpeg: # Video processing
    capabilities: hardware-accelerated
  minio: # Object storage
    port: 9000
```

## 🎯 Achievement Summary

### ✅ Completed Features

- [x] **Full Baserow Integration** - CRUD operations with JWT authentication
- [x] **TTS Generation Pipeline** - AI speech synthesis with MinIO storage
- [x] **Video Synchronization** - Local FFmpeg processing with hardware acceleration
- [x] **5-Button Production Interface** - Complete media workflow per scene
- [x] **Automation Options** - Auto-TTS and Auto-Video generation
- [x] **Responsive UI** - Card-based design with Tailwind CSS
- [x] **Error Handling** - Graceful failure recovery throughout
- [x] **Real-time Updates** - Optimistic UI with server sync
- [x] **Media Playback** - Integrated audio/video players
- [x] **File Management** - Centralized MinIO object storage

### 🚀 Production Ready

- TypeScript for type safety
- Server-side API routes for security
- Proper error boundaries and handling
- Optimized for performance and UX
- Scalable architecture with microservices

## 📊 Performance & Scalability

### Optimizations

- **Server-side Processing**: All AI operations on dedicated services
- **Optimistic Updates**: Immediate UI feedback
- **Efficient Storage**: MinIO object storage for large media files
- **Async Operations**: Non-blocking workflow processing
- **Error Boundaries**: Isolated component failures

### Metrics

- **TTS Generation**: ~2-5 seconds per scene
- **Video Synchronization**: ~10-30 seconds depending on video length
- **File Storage**: Unlimited via MinIO scaling
- **Concurrent Users**: Scalable with Next.js architecture

## 🛠️ Development

### Available Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build optimized production bundle
- `npm run start` - Start production server
- `npm run lint` - Run ESLint with TypeScript rules

### Tech Stack Deep Dive

- **Next.js 15**: App Router with Server Components
- **React 18**: Hooks, refs, and modern patterns
- **TypeScript 5**: Full type safety and IntelliSense
- **Tailwind CSS 3**: Utility-first responsive design
- **Server Actions**: Secure server-side API operations

## 🤝 Contributing

### Development Workflow

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes with proper TypeScript types
4. Test with all Docker services running
5. Submit a pull request with detailed description

### Coding Standards

- TypeScript strict mode enabled
- ESLint configuration for consistency
- Tailwind CSS for all styling
- Server Actions for API calls
- Error boundaries for component isolation

## 📄 License

This project is licensed under the MIT License. See the LICENSE file for details.

## 🙏 Acknowledgments

- **Baserow**: Self-hosted database platform
- **MinIO**: High-performance object storage
- **NVIDIA Parakeet**: High-quality transcription model
- **FFmpeg**: Powerful multimedia framework
- **Next.js Team**: Amazing React framework
- **Tailwind Labs**: Beautiful utility-first CSS
