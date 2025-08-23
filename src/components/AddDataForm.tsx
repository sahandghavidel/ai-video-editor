'use client';

import { useState, useTransition } from 'react';
import { createBaserowRow } from '@/lib/baserow-actions';

interface AddDataFormProps {
  onDataAdded?: () => void;
}

export default function AddDataForm({ onDataAdded }: AddDataFormProps) {
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [fields, setFields] = useState<string[]>(['']);
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const addField = () => {
    setFields([...fields, '']);
  };

  const removeField = (index: number) => {
    const newFields = fields.filter((_, i) => i !== index);
    setFields(newFields);

    // Remove the corresponding form data
    const fieldName = `field_${index}`;
    const newFormData = { ...formData };
    delete newFormData[fieldName];
    setFormData(newFormData);
  };

  const updateField = (index: number, value: string) => {
    const newFields = [...fields];
    newFields[index] = value;
    setFields(newFields);
  };

  const updateFieldValue = (fieldName: string, value: string) => {
    setFormData({
      ...formData,
      [fieldName]: value,
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    // Create the data object with proper field names
    const dataToSubmit: Record<string, string> = {};
    fields.forEach((fieldName, index) => {
      if (fieldName.trim()) {
        const value = formData[`field_${index}`] || '';
        dataToSubmit[fieldName.trim()] = value;
      }
    });

    if (Object.keys(dataToSubmit).length === 0) {
      setMessage({
        type: 'error',
        text: 'Please add at least one field with a name and value.',
      });
      return;
    }

    startTransition(async () => {
      try {
        await createBaserowRow(dataToSubmit);
        setMessage({ type: 'success', text: 'Data added successfully!' });
        setFormData({});
        setFields(['']);
        onDataAdded?.();
      } catch (error) {
        setMessage({
          type: 'error',
          text: error instanceof Error ? error.message : 'Failed to add data',
        });
      }
    });
  };

  return (
    <div className='bg-white p-6 rounded-lg shadow-md'>
      <h3 className='text-lg font-semibold text-gray-800 mb-4'>Add New Data</h3>

      {message && (
        <div
          className={`mb-4 p-3 rounded ${
            message.type === 'success'
              ? 'bg-green-100 text-green-700'
              : 'bg-red-100 text-red-700'
          }`}
        >
          {message.text}
        </div>
      )}

      <form onSubmit={handleSubmit} className='space-y-4'>
        {fields.map((fieldName, index) => (
          <div key={index} className='flex gap-2 items-end'>
            <div className='flex-1'>
              <label className='block text-sm font-medium text-gray-700 mb-1'>
                Field Name
              </label>
              <input
                type='text'
                value={fieldName}
                onChange={(e) => updateField(index, e.target.value)}
                placeholder='Enter field name (e.g., name, email, description)'
                className='w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500'
                disabled={isPending}
              />
            </div>
            <div className='flex-1'>
              <label className='block text-sm font-medium text-gray-700 mb-1'>
                Value
              </label>
              <input
                type='text'
                value={formData[`field_${index}`] || ''}
                onChange={(e) =>
                  updateFieldValue(`field_${index}`, e.target.value)
                }
                placeholder='Enter value'
                className='w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500'
                disabled={isPending}
              />
            </div>
            {fields.length > 1 && (
              <button
                type='button'
                onClick={() => removeField(index)}
                className='px-3 py-2 text-red-600 hover:text-red-800 disabled:opacity-50'
                disabled={isPending}
              >
                Remove
              </button>
            )}
          </div>
        ))}

        <div className='flex gap-2'>
          <button
            type='button'
            onClick={addField}
            className='px-4 py-2 text-blue-600 border border-blue-600 rounded hover:bg-blue-50 disabled:opacity-50'
            disabled={isPending}
          >
            Add Field
          </button>
          <button
            type='submit'
            className='px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50'
            disabled={isPending}
          >
            {isPending ? 'Adding...' : 'Add Data'}
          </button>
        </div>
      </form>
    </div>
  );
}
