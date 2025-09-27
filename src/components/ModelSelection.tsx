'use client';

import { useAppStore } from '@/store/useAppStore';
import { RefreshCw, Bot, Search } from 'lucide-react';

export default function ModelSelection() {
  const { modelSelection, setSelectedModel, setModelSearch, fetchModels } =
    useAppStore();

  return (
    <div className='p-3 rounded-lg border border-gray-200 bg-white shadow-sm hover:shadow-md transition-shadow duration-200'>
      {/* Header - Compact */}
      <div className='flex items-center justify-between mb-3'>
        <div className='flex items-center space-x-2'>
          <Bot className='w-4 h-4 text-blue-500' />
          <div>
            <h3 className='text-sm font-semibold text-gray-900'>AI Models</h3>
            <div className='flex items-center space-x-1'>
              <span className='px-1.5 py-0.5 bg-blue-100 text-blue-600 text-xs rounded-full'>
                OpenRouter
              </span>
              {modelSelection.selectedModel && (
                <span className='px-1.5 py-0.5 bg-green-100 text-green-600 text-xs rounded-full'>
                  Active
                </span>
              )}
            </div>
          </div>
        </div>
        <button
          onClick={fetchModels}
          disabled={modelSelection.modelsLoading}
          className='p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors disabled:opacity-50'
          title='Refresh models'
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${
              modelSelection.modelsLoading ? 'animate-spin' : ''
            }`}
          />
        </button>
      </div>

      {/* Content - Compact */}
      <div className='space-y-3'>
        {modelSelection.modelsLoading ? (
          <div className='flex items-center justify-center py-4 bg-blue-50 border border-blue-200 rounded-lg'>
            <RefreshCw className='w-4 h-4 animate-spin text-blue-600 mr-2' />
            <span className='text-sm text-blue-700'>Loading...</span>
          </div>
        ) : modelSelection.modelsError ? (
          <div className='p-3 bg-red-50 border border-red-200 rounded-lg'>
            <p className='text-xs text-red-700 mb-2'>Error loading models</p>
            <button
              onClick={fetchModels}
              className='px-2 py-1 bg-red-100 text-red-700 hover:bg-red-200 rounded text-xs transition-colors'
            >
              Retry
            </button>
          </div>
        ) : modelSelection.models.length > 0 ? (
          <div className='space-y-3'>
            {/* Search Input - Compact */}
            <div className='space-y-1'>
              <div className='relative'>
                <Search className='absolute left-2.5 top-1/2 transform -translate-y-1/2 text-gray-400 w-3.5 h-3.5' />
                <input
                  type='text'
                  className='w-full pl-8 pr-3 py-2 text-sm border border-gray-300 rounded-md bg-white focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors'
                  placeholder='Search models...'
                  value={modelSelection.modelSearch}
                  onChange={(e) => setModelSearch(e.target.value)}
                />
              </div>
              {modelSelection.modelSearch && (
                <p className='text-xs text-gray-500'>
                  {
                    modelSelection.models.filter((m) =>
                      (m.name || m.id)
                        .toLowerCase()
                        .includes(modelSelection.modelSearch.toLowerCase())
                    ).length
                  }{' '}
                  models found
                </p>
              )}
            </div>

            {/* Model Select - Compact */}
            <div className='space-y-1'>
              <select
                className='w-full px-3 py-2 text-sm border border-gray-300 rounded-md bg-white focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors'
                value={modelSelection.selectedModel || ''}
                onChange={(e) => setSelectedModel(e.target.value)}
              >
                <option value=''>Select model...</option>
                {modelSelection.models
                  .filter((m) =>
                    (m.name || m.id)
                      .toLowerCase()
                      .includes(modelSelection.modelSearch.toLowerCase())
                  )
                  .map((m) => (
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
            <p className='text-xs text-yellow-800 mb-2'>No models available</p>
            <button
              onClick={fetchModels}
              className='px-3 py-1 bg-yellow-100 text-yellow-800 hover:bg-yellow-200 rounded text-xs transition-colors'
            >
              Load Models
            </button>
          </div>
        )}

        {/* Selected Model Display - Compact */}
        {modelSelection.selectedModel && (
          <div className='p-2 bg-green-50 border border-green-200 rounded-lg'>
            <p className='text-xs font-medium text-green-800 mb-1'>Selected</p>
            <p className='text-green-700 font-mono text-xs break-all'>
              {modelSelection.selectedModel}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
