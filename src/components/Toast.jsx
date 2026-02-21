import { Toaster } from 'react-hot-toast';

const ToastConfig = () => {
  return (
    <Toaster
      position="top-right"
      toastOptions={{
        duration: 4000,
        style: {
          background: '#1a1a1a',
          color: '#fff',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: '1rem',
          padding: '1rem 1.25rem',
          fontSize: '0.875rem',
          boxShadow: '0 10px 40px rgba(0, 0, 0, 0.3)',
        },
        success: {
          duration: 3000,
          iconTheme: {
            primary: '#FF0077',
            secondary: '#fff',
          },
          style: {
            border: '1px solid rgba(255, 0, 119, 0.3)',
            boxShadow: '0 0 20px rgba(255, 0, 119, 0.2)',
          },
        },
        error: {
          duration: 4000,
          iconTheme: {
            primary: '#ef4444',
            secondary: '#fff',
          },
          style: {
            border: '1px solid rgba(239, 68, 68, 0.3)',
          },
        },
        loading: {
          iconTheme: {
            primary: '#FF0077',
            secondary: '#fff',
          },
        },
      }}
    />
  );
};

export default ToastConfig;
