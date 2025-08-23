# Ultimate Video Editor - Baserow Data Dashboard

A Next.js application that displays and manages data from a Baserow database using server actions.

## Features

- **View Baserow Data**: Display data from your Baserow table in a clean, responsive table format
- **Add New Records**: Use the built-in form to add new data to your Baserow table
- **Server Actions**: All API requests are handled server-side for better security and performance
- **Real-time Updates**: Refresh data without page reload
- **Error Handling**: Comprehensive error handling with user-friendly messages
- **TypeScript**: Fully typed for better development experience
- **Tailwind CSS**: Modern, responsive styling

## Setup Instructions

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

## Server Actions

The application uses Next.js server actions for all Baserow API interactions:

- `getBaserowData()` - Fetch all records from the table
- `createBaserowRow()` - Create a new record
- `updateBaserowRow()` - Update an existing record
- `deleteBaserowRow()` - Delete a record

## API Reference

### Baserow API Endpoints Used

- `GET /api/database/rows/table/{table_id}/` - List all rows
- `POST /api/database/rows/table/{table_id}/` - Create a new row
- `PATCH /api/database/rows/table/{table_id}/{row_id}/` - Update a row
- `DELETE /api/database/rows/table/{table_id}/{row_id}/` - Delete a row

## Troubleshooting

### Common Issues

1. **"Missing Baserow configuration" Error**

   - Ensure all environment variables are set in `.env.local`
   - For self-hosted: BASEROW_API_URL, BASEROW_EMAIL, BASEROW_PASSWORD, BASEROW_TABLE_ID
   - Restart the development server after adding environment variables

2. **"Authentication failed" Error**

   - Check that your email and password are correct
   - Ensure your Baserow instance is accessible from your development environment

3. **"Baserow API error: 404" Error**

   - Verify your table ID is correct
   - Ensure the table exists in your Baserow workspace
   - Check that the API URL is correct (should end with `/api`)

4. **Connection Issues with Docker**

   - If using Docker, ensure `host.docker.internal` resolves correctly
   - Try using `localhost` or the actual IP address if needed

5. **No Data Displayed**
   - Check that your Baserow table contains data
   - Verify your table ID and API token are correct

## Development

### Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run ESLint

### Technologies Used

- **Next.js 15** - React framework with App Router
- **TypeScript** - Type safety
- **Tailwind CSS** - Styling
- **Server Actions** - Server-side API calls
- **Baserow API** - Database operations

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

This project is licensed under the MIT License.
