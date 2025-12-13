'use client';

import React from 'react';
import {
  CheckCircle,
  ChevronDown,
  ChevronRight,
  DownloadCloud,
  Eye,
  EyeOff,
  Maximize,
  RotateCcw,
  Save,
  Settings,
  Trash,
} from 'lucide-react';
import type { TextStyling } from './types';

type Props = {
  textOverlayPosition: { x: number; y: number };
  setTextOverlayPosition: React.Dispatch<
    React.SetStateAction<{ x: number; y: number }>
  >;
  textOverlaySize: { width: number; height: number };
  setTextOverlaySize: React.Dispatch<
    React.SetStateAction<{ width: number; height: number }>
  >;

  isTextStylingSectionOpen: boolean;
  setIsTextStylingSectionOpen: React.Dispatch<React.SetStateAction<boolean>>;

  textStyling: TextStyling;
  setTextStyling: React.Dispatch<React.SetStateAction<TextStyling>>;

  ffmpegFonts: Record<string, string>;
  availableFontFamilies: string[];

  showFontPreview: boolean;
  setShowFontPreview: React.Dispatch<React.SetStateAction<boolean>>;
  isFontLoaded: boolean;

  saveCurrentTextStyle: () => void;
  savedTextStyles: { name: string; style: TextStyling }[];
  applySavedTextStyle: (preset: { name: string; style: TextStyling }) => void;
  deleteSavedTextStyle: (name: string) => void;
};

export function TextOverlayControls({
  textOverlayPosition,
  setTextOverlayPosition,
  textOverlaySize,
  setTextOverlaySize,
  isTextStylingSectionOpen,
  setIsTextStylingSectionOpen,
  textStyling,
  setTextStyling,
  ffmpegFonts,
  availableFontFamilies,
  showFontPreview,
  setShowFontPreview,
  isFontLoaded,
  saveCurrentTextStyle,
  savedTextStyles,
  applySavedTextStyle,
  deleteSavedTextStyle,
}: Props) {
  return (
    <div className='space-y-2'>
      <div className='flex gap-2 items-end w-full'>
        <div className='flex-1'>
          <label className='block text-xs text-gray-600'>X (%)</label>
          <input
            type='number'
            value={textOverlayPosition.x}
            onChange={(e) =>
              setTextOverlayPosition((prev) => ({
                ...prev,
                x: Number(e.target.value),
              }))
            }
            className='w-full px-2 py-1 border border-gray-300 rounded text-sm'
            min='0'
            max='100'
          />
        </div>
        <div className='flex-1'>
          <label className='block text-xs text-gray-600'>Y (%)</label>
          <input
            type='number'
            value={textOverlayPosition.y}
            onChange={(e) =>
              setTextOverlayPosition((prev) => ({
                ...prev,
                y: Number(e.target.value),
              }))
            }
            className='w-full px-2 py-1 border border-gray-300 rounded text-sm'
            min='0'
            max='100'
          />
        </div>
        <div className='flex-1'>
          <label className='block text-xs text-gray-600'>Font Size (%)</label>
          <input
            type='number'
            value={textOverlaySize.width}
            onChange={(e) =>
              setTextOverlaySize((prev) => ({
                ...prev,
                width: Number(e.target.value),
              }))
            }
            className='w-full px-2 py-1 border border-gray-300 rounded text-sm'
            min='5'
            max='100'
          />
        </div>
        <div className='flex-shrink-0 mt-4'>
          <button
            onClick={() => {
              setTextOverlayPosition({ x: 50, y: 50 });
              setTextOverlaySize({ width: 100, height: 100 });
            }}
            className='px-1 py-1 border border-gray-300 rounded hover:bg-gray-50 text-gray-600 hover:text-gray-800 h-8 flex items-center justify-center'
            title='Center and reset size'
          >
            <RotateCcw className='h-3 w-3' />
          </button>
        </div>
        <div className='flex-shrink-0 mt-4'>
          <button
            onClick={() => {
              setTextOverlayPosition({ x: 50, y: 50 });
              setTextOverlaySize({ width: 100, height: 100 });
            }}
            className='px-1 py-1 border border-gray-300 rounded hover:bg-gray-50 text-gray-600 hover:text-gray-800 h-8 flex items-center justify-center'
            title='Center and maximize size'
          >
            <Maximize className='h-3 w-3' />
          </button>
        </div>
      </div>

      {/* Text Styling Controls */}
      <div className='space-y-1 mt-2'>
        <button
          type='button'
          onClick={() => setIsTextStylingSectionOpen((s) => !s)}
          className='flex items-center gap-2 mb-2 w-full text-left'
          aria-expanded={isTextStylingSectionOpen}
        >
          <Settings className='h-4 w-4 text-gray-600' />
          <span className='text-xs font-medium text-gray-700'>
            Text styling
          </span>
          <span className='ml-auto text-gray-600'>
            {isTextStylingSectionOpen ? (
              <ChevronDown className='h-4 w-4' />
            ) : (
              <ChevronRight className='h-4 w-4' />
            )}
          </span>
        </button>

        {isTextStylingSectionOpen && (
          <div className='flex flex-wrap gap-2 items-end'>
            <div className='flex flex-col'>
              <label className='sr-only'>Font</label>
              <div className='flex items-center gap-1'>
                <select
                  value={textStyling.fontFamily}
                  onChange={(e) =>
                    setTextStyling((prev) => ({
                      ...prev,
                      fontFamily: e.target.value,
                    }))
                  }
                  className='w-32 px-1 py-0.5 border border-gray-300 rounded text-xs'
                  title={ffmpegFonts[textStyling.fontFamily] || ''}
                >
                  {availableFontFamilies.map((family) => (
                    <option
                      key={family}
                      value={family}
                      title={ffmpegFonts[family] || ''}
                    >
                      {family}
                    </option>
                  ))}
                </select>
                {ffmpegFonts[textStyling.fontFamily] ? (
                  <span title='Font available'>
                    <CheckCircle className='h-4 w-4 text-green-500' />
                  </span>
                ) : (
                  <span
                    className='h-4 w-4 text-gray-400'
                    title='Font not installed. Run scripts/install_fonts.sh to add fonts locally.'
                  >
                    <DownloadCloud className='h-4 w-4' />
                  </span>
                )}
                <button
                  className='p-1 rounded hover:bg-gray-100'
                  title={showFontPreview ? 'Hide preview' : 'Show preview'}
                  onClick={() => setShowFontPreview((s) => !s)}
                  type='button'
                >
                  {showFontPreview ? (
                    <EyeOff className='h-4 w-4 text-gray-600' />
                  ) : (
                    <Eye className='h-4 w-4 text-gray-600' />
                  )}
                </button>
              </div>
              {showFontPreview && (
                <div className='mt-1 flex items-center gap-2'>
                  <div
                    className='text-sm font-semibold leading-5'
                    style={{
                      fontFamily: textStyling.fontFamily,
                      fontSize: '12px',
                    }}
                  >
                    LAST WEEK
                  </div>
                  <div className='text-xs flex items-center gap-1'>
                    {isFontLoaded ? (
                      <span title='Font loaded in browser'>
                        <CheckCircle className='h-3 w-3 text-green-600' />
                        <span className='sr-only'>Loaded</span>
                      </span>
                    ) : (
                      <span title='Font not loaded in browser'>
                        <DownloadCloud className='h-3 w-3 text-gray-400' />
                        <span className='sr-only'>Not loaded</span>
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className='flex flex-col'>
              <label className='sr-only'>Color</label>
              <div className='flex items-center gap-2'>
                <input
                  type='color'
                  value={textStyling.fontColor}
                  onChange={(e) =>
                    setTextStyling((prev) => ({
                      ...prev,
                      fontColor: e.target.value,
                    }))
                  }
                  className='w-8 h-6 border border-gray-300 rounded cursor-pointer p-0'
                  title={`Font color: ${textStyling.fontColor}`}
                  aria-label={`Font color: ${textStyling.fontColor}`}
                />
                <span className='text-xs text-gray-500 font-mono'>
                  {textStyling.fontColor}
                </span>
              </div>
            </div>

            <div className='flex flex-col'>
              <label className='sr-only'>Border</label>
              <div className='flex items-center gap-1'>
                <input
                  type='number'
                  value={textStyling.borderWidth}
                  onChange={(e) =>
                    setTextStyling((prev) => ({
                      ...prev,
                      borderWidth: Number(e.target.value),
                    }))
                  }
                  className='w-14 px-1 py-0.5 border border-gray-300 rounded text-xs'
                  min='0'
                  max='10'
                />
                <input
                  type='color'
                  value={textStyling.borderColor}
                  onChange={(e) =>
                    setTextStyling((prev) => ({
                      ...prev,
                      borderColor: e.target.value,
                    }))
                  }
                  className='w-8 h-6 border border-gray-300 rounded cursor-pointer'
                  title={`Border color: ${textStyling.borderColor}`}
                  aria-label={`Border color: ${textStyling.borderColor}`}
                />
              </div>
            </div>

            <div className='flex flex-col'>
              <label className='sr-only'>Shadow</label>
              <div className='flex items-center gap-1'>
                <input
                  type='number'
                  value={textStyling.shadowX}
                  onChange={(e) =>
                    setTextStyling((prev) => ({
                      ...prev,
                      shadowX: Number(e.target.value),
                    }))
                  }
                  className='w-12 px-1 py-0.5 border border-gray-300 rounded text-xs'
                  min='0'
                  max='20'
                  placeholder='X'
                />
                <input
                  type='number'
                  value={textStyling.shadowY}
                  onChange={(e) =>
                    setTextStyling((prev) => ({
                      ...prev,
                      shadowY: Number(e.target.value),
                    }))
                  }
                  className='w-12 px-1 py-0.5 border border-gray-300 rounded text-xs'
                  min='0'
                  max='20'
                  placeholder='Y'
                />
                <input
                  type='number'
                  value={textStyling.shadowOpacity}
                  onChange={(e) =>
                    setTextStyling((prev) => ({
                      ...prev,
                      shadowOpacity: Number(e.target.value),
                    }))
                  }
                  className='w-16 px-1 py-0.5 border border-gray-300 rounded text-xs'
                  min={0}
                  max={1}
                  step={0.1}
                />
                <input
                  type='color'
                  value={textStyling.shadowColor}
                  onChange={(e) =>
                    setTextStyling((prev) => ({
                      ...prev,
                      shadowColor: e.target.value,
                    }))
                  }
                  className='w-8 h-6 border border-gray-300 rounded cursor-pointer'
                  title={`Shadow color: ${textStyling.shadowColor}`}
                  aria-label={`Shadow color: ${textStyling.shadowColor}`}
                />
              </div>
            </div>

            <div className='flex flex-col'>
              <label className='sr-only'>Background</label>
              <div className='flex items-center gap-1'>
                <input
                  type='color'
                  value={textStyling.bgColor ?? '#000000'}
                  onChange={(e) =>
                    setTextStyling((prev) => ({
                      ...prev,
                      bgColor: e.target.value,
                    }))
                  }
                  className='w-8 h-6 border border-gray-300 rounded cursor-pointer'
                  title={`Background color: ${
                    textStyling.bgColor ?? '#000000'
                  }`}
                  aria-label={`Background color: ${
                    textStyling.bgColor ?? '#000000'
                  }`}
                />
                <input
                  type='number'
                  value={textStyling.bgOpacity ?? 0.65}
                  onChange={(e) =>
                    setTextStyling((prev) => ({
                      ...prev,
                      bgOpacity: Number(e.target.value),
                    }))
                  }
                  className='w-16 px-1 py-0.5 border border-gray-300 rounded text-xs'
                  min={0}
                  max={1}
                  step={0.05}
                  title='Background opacity'
                />
                <input
                  type='number'
                  value={textStyling.bgSize ?? 8}
                  onChange={(e) =>
                    setTextStyling((prev) => ({
                      ...prev,
                      bgSize: Number(e.target.value),
                    }))
                  }
                  className='w-16 px-1 py-0.5 border border-gray-300 rounded text-xs'
                  min={0}
                  max={200}
                  title='Background padding'
                />
              </div>
            </div>

            <button
              onClick={() => {
                const saved = localStorage.getItem('defaultTextStyling');
                setTextStyling(
                  saved
                    ? JSON.parse(saved)
                    : {
                        fontColor: '#ffffff',
                        borderWidth: 3,
                        borderColor: '#000000',
                        shadowX: 8,
                        shadowY: 8,
                        shadowColor: '#000000',
                        shadowOpacity: 0.9,
                        fontFamily: 'Helvetica',
                        bgColor: '#000000',
                        bgOpacity: 0.65,
                        bgSize: 8,
                      }
                );
              }}
              className='flex items-center justify-center px-2 py-1 bg-gray-500 text-white rounded hover:bg-gray-600 h-7 w-7'
              title='Reset text styling to default'
              aria-label='Reset text styling'
            >
              <RotateCcw className='h-4 w-4' />
            </button>
            <button
              onClick={() => {
                localStorage.setItem(
                  'defaultTextStyling',
                  JSON.stringify(textStyling)
                );
                alert('Text styling saved as default!');
              }}
              className='flex items-center justify-center px-2 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 h-7 w-7'
              title='Save as default text styling'
              aria-label='Save default text styling'
            >
              <Save className='h-4 w-4' />
            </button>
            <button
              onClick={saveCurrentTextStyle}
              className='flex items-center justify-center px-2 py-1 bg-green-500 text-white rounded hover:bg-green-600 h-7 w-7'
              title='Save text styling as preset'
            >
              <Save className='h-4 w-4' />
              <span className='sr-only'>Save</span>
            </button>
          </div>
        )}

        {/* Presets (inline, no dropdown) */}
        <div className='mt-2'>
          {savedTextStyles.length === 0 ? (
            <div className='text-xs text-gray-500'>No presets saved</div>
          ) : (
            <div className='grid grid-cols-2 sm:grid-cols-3 gap-2'>
              {savedTextStyles.map((s) => {
                const style = s.style;
                return (
                  <div
                    key={s.name}
                    role='button'
                    tabIndex={0}
                    onClick={() => applySavedTextStyle(s)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        applySavedTextStyle(s);
                      }
                    }}
                    className='group relative text-left rounded border border-gray-200 hover:border-gray-300 hover:bg-gray-50 px-2 py-2 cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500'
                    title={s.name}
                    aria-label={`Apply preset ${s.name}`}
                  >
                    <button
                      type='button'
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteSavedTextStyle(s.name);
                      }}
                      className='absolute top-1 right-1 p-1 rounded text-red-600 hover:bg-gray-100 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity'
                      title='Delete preset'
                      aria-label={`Delete preset ${s.name}`}
                    >
                      <Trash className='h-4 w-4' />
                    </button>

                    <div className='flex items-center justify-between gap-2 pr-6'>
                      <div
                        className='min-w-0 whitespace-nowrap truncate'
                        style={{
                          fontFamily: style.fontFamily,
                          color: '#000000',
                          WebkitTextStroke: 'none',
                          textShadow: 'none',
                          lineHeight: 1.05,
                          fontSize: '14px',
                          fontWeight: 700,
                        }}
                      >
                        {s.name}
                      </div>

                      <div className='flex items-center gap-1 shrink-0'>
                        <span
                          className='h-3 w-3 rounded-sm border border-gray-300'
                          style={{ backgroundColor: style.fontColor }}
                          title='Text color'
                          aria-label='Text color'
                        />
                        <span
                          className='h-3 w-3 rounded-sm border border-gray-300'
                          style={{ backgroundColor: style.borderColor }}
                          title='Border color'
                          aria-label='Border color'
                        />
                        <span
                          className='h-3 w-3 rounded-sm border border-gray-300'
                          style={{ backgroundColor: style.shadowColor }}
                          title='Shadow color'
                          aria-label='Shadow color'
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
