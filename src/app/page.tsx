'use client';

import { getBaserowData, BaserowRow } from '@/lib/baserow-actions';
import SceneCard from '@/components/SceneCard';
import AddDataForm from '@/components/AddDataForm';
import { useEffect } from 'react';
import { useAppStore } from '@/store/useAppStore';

export default function Home() {
  const { data, error, loading, setData, setError, setLoading } = useAppStore();

  const loadData = async () => {
    try {
      setLoading(true);
      const fetchedData = await getBaserowData();
      setData(fetchedData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
      console.error('Error loading Baserow data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleDataUpdate = (updatedData: BaserowRow[]) => {
    setData(updatedData);
  };

  const refreshData = () => {
    loadData();
  };

  return (
    <div className='min-h-screen bg-gray-50'>
      <div className='max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8'>
        <header className='mb-8'>
          <h1 className='text-3xl font-bold text-gray-900'>
            Baserow Data Dashboard
          </h1>
          <p className='mt-2 text-gray-600'>
            View and manage your Baserow database data
          </p>
        </header>

        {error ? (
          <div className='bg-red-50 border border-red-200 rounded-lg p-6 mb-8'>
            <div className='flex items-center'>
              <div className='flex-shrink-0'>
                <svg
                  className='h-5 w-5 text-red-400'
                  viewBox='0 0 20 20'
                  fill='currentColor'
                >
                  <path
                    fillRule='evenodd'
                    d='M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z'
                    clipRule='evenodd'
                  />
                </svg>
              </div>
              <div className='ml-3'>
                <h3 className='text-sm font-medium text-red-800'>
                  Configuration Error
                </h3>
                <div className='mt-2 text-sm text-red-700'>
                  <p>{error}</p>
                  <p className='mt-2'>
                    Please check your{' '}
                    <code className='bg-red-100 px-1 rounded'>.env.local</code>{' '}
                    file and ensure:
                  </p>
                  <ul className='mt-1 list-disc list-inside space-y-1'>
                    <li>
                      BASEROW_API_URL is set (e.g.,
                      http://host.docker.internal/api)
                    </li>
                    <li>BASEROW_EMAIL is set with your Baserow login email</li>
                    <li>BASEROW_PASSWORD is set with your Baserow password</li>
                    <li>BASEROW_TABLE_ID is set with your table ID</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className='space-y-8'>
            {loading && (
              <div className='flex justify-center items-center py-8'>
                <div className='text-gray-500'>Loading data...</div>
              </div>
            )}
            <SceneCard
              data={data}
              refreshData={refreshData}
              onDataUpdate={handleDataUpdate}
            />
          </div>
        )}
      </div>
    </div>
  );
}
