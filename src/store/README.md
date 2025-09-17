# Store Documentation

## useAppStore

The main Zustand store for managing global application state.

### State

#### Core Data

- `data: BaserowRow[]` - Array of rows from Baserow database
- `loading: boolean` - Loading state for async operations
- `error: string | null` - Error message for display

#### TTS Settings

- `ttsSettings: TTSSettings` - Text-to-speech configuration
  - `temperature: number` - Controls randomness (0-2)
  - `exaggeration: number` - Controls emphasis (0-1)
  - `cfg_weight: number` - Controls adherence to conditioning (0-1)
  - `seed: number` - Random seed for reproducibility
  - `reference_audio_filename: string` - Reference audio file name

#### Video Settings

- `videoSettings: VideoSettings` - Video processing configuration
  - `selectedSpeed: number` - Video processing speed multiplier (1-10)
  - `muteAudio: boolean` - Whether to mute audio in generated videos
  - `autoGenerateVideo: boolean` - Auto-generate video after TTS
  - `autoGenerateTTS: boolean` - Auto-generate TTS after text changes

### Actions

#### Core Data Actions

- `setData(data: BaserowRow[])` - Replace entire data array
- `setLoading(loading: boolean)` - Update loading state
- `setError(error: string | null)` - Update error state
- `updateRow(id: number, updates: Partial<BaserowRow>)` - Update single row
- `addRow(row: BaserowRow)` - Add new row to data

#### TTS Settings Actions

- `updateTTSSettings(updates: Partial<TTSSettings>)` - Update TTS settings
- `resetTTSSettings()` - Reset TTS settings to defaults

#### Video Settings Actions

- `updateVideoSettings(updates: Partial<VideoSettings>)` - Update video settings
- `resetVideoSettings()` - Reset video settings to defaults

### Usage Examples

```typescript
import { useAppStore } from '@/store/useAppStore';

// Basic usage
const { data, loading, error } = useAppStore();

// TTS settings
const { ttsSettings, updateTTSSettings } = useAppStore();
updateTTSSettings({ temperature: 0.9 });

// Video settings
const { videoSettings, updateVideoSettings } = useAppStore();
updateVideoSettings({ selectedSpeed: 6, muteAudio: false });

// Reset to defaults
const { resetTTSSettings, resetVideoSettings } = useAppStore();
resetTTSSettings();
resetVideoSettings();
```

### Default Values

#### TTS Settings Defaults

- temperature: 0.8
- exaggeration: 0.3
- cfg_weight: 0.5
- seed: 1212
- reference_audio_filename: 'calmS5wave.wav'

#### Video Settings Defaults

- selectedSpeed: 4
- muteAudio: true
- autoGenerateVideo: true
- autoGenerateTTS: false

```

```
