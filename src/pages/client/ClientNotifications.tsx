import React from 'react';
import { NotificationsCenter } from '../../components/common/NotificationsCenter';

export const ClientNotifications: React.FC = () => {
  return (
    <NotificationsCenter
      portal="client"
      title="Notifications & Alerts"
    />
  );
};
