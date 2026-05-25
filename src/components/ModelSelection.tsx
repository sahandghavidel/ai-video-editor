'use client';

import { useAppStore } from '@/store/useAppStore';
import { RefreshCw, Bot, Search, Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';

export default function ModelSelection() {
  const [showLocalApiKey, setShowLocalApiKey] = useState(false);
  const [showLocalAdminApiKey, setShowLocalAdminApiKey] = useState(false);

  const {
    modelSelection,
    setModelProvider,
    setSelectedModel,
    setModelSearch,
    setSelectedLocalModel,
    setLocalModelSearch,
    setLocalEndpoint,
    setLocalApiKey,
    setLocalAdminApiKey,
    setEnforceLongerSentences,
    fetchModels,
    fetchLocalModels,
  } = useAppStore();

  const isLocalProvider = modelSelection.provider === 'local';
  const activeModels = isLocalProvider
    ? modelSelection.localModels
    : modelSelection.models;
  const activeModelsLoading = isLocalProvider
    ? modelSelection.localModelsLoading
    : modelSelection.modelsLoading;
  const activeModelsError = isLocalProvider
    ? modelSelection.localModelsError
    : modelSelection.modelsError;
  const activeModelSearch = isLocalProvider
    ? modelSelection.localModelSearch
    : modelSelection.modelSearch;
  const activeSelectedModel = isLocalProvider
    ? modelSelection.selectedLocalModel
    : modelSelection.selectedModel;

  const filteredModels = activeModels.filter((m) =>
    (m.name || m.id).toLowerCase().includes(activeModelSearch.toLowerCase()),
  );

  const refreshActiveModels = () => {
    if (isLocalProvider) {
      void fetchLocalModels();
      return;
    }
    void fetchModels();
  };

  const updateActiveModelSearch = (search: string) => {
    if (isLocalProvider) {
      setLocalModelSearch(search);
      return;
    }
    setModelSearch(search);
  };

  const updateActiveSelectedModel = (modelId: string) => {
    if (isLocalProvider) {
      setSelectedLocalModel(modelId || null);
      return;
    }
    setSelectedModel(modelId || null);
  };

  return (
    <div className='p-3 rounded-lg border border-gray-200 bg-white shadow-sm hover:shadow-md transition-shadow duration-200'>
      {/* Header - Compact */}
      <div className='flex items-center justify-between mb-3'>
        <div className='flex items-center space-x-2'>
          <Bot className='w-4 h-4 text-blue-500' />
          <div>
            <h3 className='text-sm font-semibold text-gray-900'>AI Models</h3>
            <div className='flex items-center space-x-1'>
              <span
                className={`px-1.5 py-0.5 text-xs rounded-full ${
                  !isLocalProvider
                    ? 'bg-blue-100 text-blue-600'
                    : 'bg-gray-100 text-gray-500'
                }`}
              >
                OpenRouter
              </span>
              <span
                className={`px-1.5 py-0.5 text-xs rounded-full ${
                  isLocalProvider
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-gray-100 text-gray-500'
                }`}
              >
                OMLX Local
              </span>
              {activeSelectedModel && (
                <span className='px-1.5 py-0.5 bg-green-100 text-green-600 text-xs rounded-full'>
                  Active
                </span>
              )}
            </div>
          </div>
        </div>
        <button
          onClick={refreshActiveModels}
          disabled={activeModelsLoading}
          className='p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors disabled:opacity-50'
          title={`Refresh ${isLocalProvider ? 'local' : 'online'} models`}
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${
              activeModelsLoading ? 'animate-spin' : ''
            }`}
          />
        </button>
      </div>

      {/* Content - Compact */}
      <div className='space-y-3'>
        {/* Provider Toggle */}
        <div className='grid grid-cols-2 gap-1 rounded-lg border border-gray-200 bg-gray-100 p-1'>
          <button
            type='button'
            onClick={() => setModelProvider('online')}
            className={`px-2 py-1.5 text-xs font-medium rounded-md transition-colors ${
              !isLocalProvider
                ? 'bg-white text-blue-700 shadow-sm border border-blue-100'
                : 'text-gray-600 hover:text-gray-800'
            }`}
          >
            Online
          </button>
          <button
            type='button'
            onClick={() => setModelProvider('local')}
            className={`px-2 py-1.5 text-xs font-medium rounded-md transition-colors ${
              isLocalProvider
                ? 'bg-white text-emerald-700 shadow-sm border border-emerald-100'
                : 'text-gray-600 hover:text-gray-800'
            }`}
          >
            Local (OMLX)
          </button>
        </div>

        {/* Local OMLX Settings */}
        <div className='p-2 rounded-lg border border-gray-200 bg-gray-50 space-y-2'>
          <div className='flex items-center justify-between gap-2'>
            <p className='text-xs font-semibold text-gray-800'>
              Local OMLX (OpenAI-compatible)
            </p>
            <button
              type='button'
              onClick={() => {
                setModelProvider('local');
                void fetchLocalModels();
              }}
              className='px-2 py-1 text-xs rounded-md border border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition-colors'
            >
              Load Local Models
            </button>
          </div>

          <div className='space-y-1'>
            <label className='text-xs text-gray-600'>Endpoint</label>
            <input
              type='text'
              value={modelSelection.localEndpoint}
              onChange={(e) => setLocalEndpoint(e.target.value)}
              className='w-full px-2 py-1.5 text-xs border border-gray-300 rounded-md bg-white focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 transition-colors'
              placeholder='http://127.0.0.1:9573/v1'
            />
          </div>

          <div className='space-y-1'>
            <label className='text-xs text-gray-600'>API Key</label>
            <div className='relative'>
              <input
                type={showLocalApiKey ? 'text' : 'password'}
                value={modelSelection.localApiKey}
                onChange={(e) => setLocalApiKey(e.target.value)}
                className='w-full px-2 py-1.5 pr-9 text-xs border border-gray-300 rounded-md bg-white focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 transition-colors'
                placeholder='Optional (if your OMLX server requires auth)'
              />
              <button
                type='button'
                onClick={() => setShowLocalApiKey((prev) => !prev)}
                className='absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600'
                title={showLocalApiKey ? 'Hide API key' : 'Show API key'}
              >
                {showLocalApiKey ? (
                  <EyeOff className='w-3.5 h-3.5' />
                ) : (
                  <Eye className='w-3.5 h-3.5' />
                )}
              </button>
            </div>
          </div>

          <div className='space-y-1'>
            <label className='text-xs text-gray-600'>Admin API Key</label>
            <div className='relative'>
              <input
                type={showLocalAdminApiKey ? 'text' : 'password'}
                value={modelSelection.localAdminApiKey}
                onChange={(e) => setLocalAdminApiKey(e.target.value)}
                className='w-full px-2 py-1.5 pr-9 text-xs border border-gray-300 rounded-md bg-white focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 transition-colors'
                placeholder='Optional (used for /admin model unload auth)'
              />
              <button
                type='button'
                onClick={() => setShowLocalAdminApiKey((prev) => !prev)}
                className='absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600'
                title={
                  showLocalAdminApiKey
                    ? 'Hide admin API key'
                    : 'Show admin API key'
                }
              >
                {showLocalAdminApiKey ? (
                  <EyeOff className='w-3.5 h-3.5' />
                ) : (
                  <Eye className='w-3.5 h-3.5' />
                )}
              </button>
            </div>
          </div>

          <p className='text-[11px] text-gray-500'>
            Default OMLX endpoint:{' '}
            <span className='font-mono'>http://127.0.0.1:9573/v1</span>
          </p>
        </div>

        {activeModelsLoading ? (
          <div className='flex items-center justify-center py-4 bg-blue-50 border border-blue-200 rounded-lg'>
            <RefreshCw className='w-4 h-4 animate-spin text-blue-600 mr-2' />
            <span className='text-sm text-blue-700'>Loading...</span>
          </div>
        ) : activeModelsError ? (
          <div className='p-3 bg-red-50 border border-red-200 rounded-lg'>
            <p className='text-xs text-red-700 mb-2'>Error loading models</p>
            <button
              onClick={refreshActiveModels}
              className='px-2 py-1 bg-red-100 text-red-700 hover:bg-red-200 rounded text-xs transition-colors'
            >
              Retry
            </button>
          </div>
        ) : activeModels.length > 0 ? (
          <div className='space-y-3'>
            {/* Search Input - Compact */}
            <div className='space-y-1'>
              <div className='relative'>
                <Search className='w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2' />
                <input
                  type='text'
                  className='w-full pl-8 p-3 py-2 text-sm border border-gray-300 rounded-md bg-white focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors'
                  placeholder='Search models...'
                  value={activeModelSearch}
                  onChange={(e) => updateActiveModelSearch(e.target.value)}
                />
              </div>
              {activeModelSearch && (
                <p className='text-xs text-gray-500'>
                  {filteredModels.length} models found
                </p>
              )}
            </div>

            {/* Model Select - Compact */}
            <div className='space-y-1'>
              <select
                className='w-full px-3 py-2 text-sm border border-gray-300 rounded-md bg-white focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors'
                value={activeSelectedModel || ''}
                onChange={(e) => updateActiveSelectedModel(e.target.value)}
              >
                <option value=''>Select model...</option>
                {filteredModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name || m.id}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : (
          <div className='text-center py-4 bg-yellow-50 border border-yellow-200 rounded-lg'>
            <Bot className='w-5 h-5 text-yellow-600 mx-auto mb-2' />
            <p className='text-xs text-yellow-800 mb-2'>
              No {isLocalProvider ? 'local' : 'online'} models available
            </p>
            <button
              onClick={refreshActiveModels}
              className='px-3 py-1 bg-yellow-100 text-yellow-800 hover:bg-yellow-200 rounded text-xs transition-colors'
            >
              Load {isLocalProvider ? 'Local' : 'Online'} Models
            </button>
          </div>
        )}

        {/* Selected Model Display - Compact */}
        {activeSelectedModel && (
          <div className='p-2 bg-green-50 border border-green-200 rounded-lg'>
            <p className='text-xs font-medium text-green-800 mb-1'>Selected</p>
            <p className='text-green-700 font-mono text-xs break-all'>
              {activeSelectedModel}
            </p>
            <p className='text-[11px] text-green-700 mt-1'>
              Source: {isLocalProvider ? 'Local OMLX' : 'Online OpenRouter'}
            </p>
          </div>
        )}

        {/* Enforce Longer Sentences Checkbox */}
        <div className='flex items-center space-x-2'>
          <input
            type='checkbox'
            id='enforceLongerSentences'
            checked={modelSelection.enforceLongerSentences}
            onChange={(e) => setEnforceLongerSentences(e.target.checked)}
            className='w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2'
          />
          <label
            htmlFor='enforceLongerSentences'
            className='text-xs text-gray-700'
          >
            Enforce longer sentences with more detail
          </label>
        </div>
      </div>
    </div>
  );
}
