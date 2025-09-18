'use client';

import { useAppStore } from '@/store/useAppStore';
import { RefreshCw, Bot, Search } from 'lucide-react';

export default function ModelSelection() {
  const { modelSelection, setSelectedModel, setModelSearch, fetchModels } =
    useAppStore();

  return (
    <div className='mb-6 p-4 sm:p-6 rounded-xl border border-gray-200 bg-gradient-to-br from-white to-gray-50 shadow-sm hover:shadow-md transition-shadow duration-200'>
      {/* Header */}
      <div className='flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6'>
        <div className='flex items-center space-x-3'>
          <div className='p-2 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg shadow-sm'>
            <Bot className='w-5 h-5 text-white' />
          </div>
          <div>
            <h3 className='text-lg font-semibold text-gray-900 mb-1'>
              AI Model Selection
            </h3>
            <div className='flex items-center space-x-2'>
              <div className='px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded-full font-medium'>
                OpenRouter
              </div>
              {modelSelection.selectedModel && (
                <div className='px-2 py-1 bg-green-100 text-green-700 text-xs rounded-full font-medium'>
                  Active
                </div>
              )}
            </div>
          </div>
        </div>

        <button
          onClick={fetchModels}
          disabled={modelSelection.modelsLoading}
          className='mt-3 sm:mt-0 inline-flex items-center px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed'
          title='Refresh model list'
        >
          <RefreshCw
            className={`w-4 h-4 mr-2 ${
              modelSelection.modelsLoading ? 'animate-spin' : ''
            }`}
          />
          {modelSelection.modelsLoading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {/* Content */}
      <div className='space-y-4'>
        {modelSelection.modelsLoading ? (
          <div className='flex items-center justify-center p-8 bg-blue-50 border border-blue-200 rounded-xl'>
            <div className='flex items-center space-x-3'>
              <div className='animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600'></div>
              <p className='text-blue-700 font-medium'>Loading AI models...</p>
            </div>
          </div>
        ) : modelSelection.modelsError ? (
          <div className='p-4 bg-red-50 border border-red-200 rounded-xl'>
            <div className='flex items-center space-x-2 mb-2'>
              <div className='w-2 h-2 bg-red-500 rounded-full'></div>
              <p className='text-sm font-medium text-red-800'>
                Error loading models
              </p>
            </div>
            <p className='text-xs text-red-600 mb-3'>
              {modelSelection.modelsError}
            </p>
            <button
              onClick={fetchModels}
              className='px-3 py-1.5 bg-red-100 text-red-700 hover:bg-red-200 rounded-lg text-xs font-medium transition-colors'
            >
              Try Again
            </button>
          </div>
        ) : modelSelection.models.length > 0 ? (
          <div className='space-y-4'>
            {/* Search Input */}
            <div className='space-y-2'>
              <label className='text-sm font-medium text-gray-700'>
                Search Models
              </label>
              <div className='relative'>
                <Search className='absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4' />
                <input
                  type='text'
                  className='w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors duration-200 placeholder-gray-500'
                  placeholder='Search for AI models...'
                  value={modelSelection.modelSearch}
                  onChange={(e) => setModelSearch(e.target.value)}
                />
              </div>
            </div>

            {/* Model Select */}
            <div className='space-y-2'>
              <label className='text-sm font-medium text-gray-700'>
                Selected Model
              </label>
              <select
                className='w-full px-4 py-3 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors duration-200'
                value={modelSelection.selectedModel || ''}
                onChange={(e) => setSelectedModel(e.target.value)}
              >
                <option value=''>Select a model...</option>
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

              {/* Filter Results Info */}
              {modelSelection.modelSearch && (
                <p className='text-xs text-gray-500'>
                  {
                    modelSelection.models.filter((m) =>
                      (m.name || m.id)
                        .toLowerCase()
                        .includes(modelSelection.modelSearch.toLowerCase())
                    ).length
                  }{' '}
                  model(s) match your search
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className='text-center p-8 bg-yellow-50 border border-yellow-200 rounded-xl'>
            <div className='w-12 h-12 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-3'>
              <Bot className='w-6 h-6 text-yellow-600' />
            </div>
            <p className='text-sm font-medium text-yellow-800 mb-2'>
              No models available
            </p>
            <p className='text-xs text-yellow-600 mb-4'>
              Click refresh to load available AI models
            </p>
            <button
              onClick={fetchModels}
              className='px-4 py-2 bg-yellow-100 text-yellow-800 hover:bg-yellow-200 rounded-lg text-sm font-medium transition-colors'
            >
              Load Models
            </button>
          </div>
        )}

        {/* Selected Model Display */}
        {modelSelection.selectedModel && (
          <div className='p-4 bg-green-50 border border-green-200 rounded-xl'>
            <div className='flex items-center space-x-2'>
              <div className='w-2 h-2 bg-green-500 rounded-full animate-pulse'></div>
              <p className='text-sm font-medium text-green-800'>
                Currently Selected
              </p>
            </div>
            <p className='text-green-700 font-mono text-sm mt-1 break-all'>
              {modelSelection.selectedModel}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
