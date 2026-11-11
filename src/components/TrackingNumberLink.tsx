import React from 'react';

interface TrackingNumberLinkProps {
  trackingNumber: string;
  className?: string;
  title?: string;
}

export const TrackingNumberLink: React.FC<TrackingNumberLinkProps> = ({
  trackingNumber,
  className = 'text-sky-600 hover:text-sky-800 hover:underline',
  title = 'Open delivery details in Bosta Admin',
}) => {
  const value = String(trackingNumber || '').trim();
  if (!value) return null;

  return (
    <a
      href={`https://beta-admin.bosta.co/deliveries/${encodeURIComponent(value)}/details`}
      target="_blank"
      rel="noopener noreferrer"
      title={title}
      className={className}
      onClick={(event) => event.stopPropagation()}
    >
      {value}
    </a>
  );
};
