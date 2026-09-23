let notificationsModule: any | null | undefined;

const getNotifications = () => {
  if (notificationsModule !== undefined) {
    return notificationsModule;
  }

  try {
    notificationsModule = require('expo-notifications');
  } catch (error) {
    console.warn('expo-notifications is unavailable in this runtime:', error);
    notificationsModule = null;
  }

  return notificationsModule;
};

export const configureNotifications = () => {
  const Notifications = getNotifications();
  if (!Notifications?.setNotificationHandler) {
    return;
  }

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
};

export const scheduleMealReminder = async (mealName: string, triggerDate: Date) => {
  const Notifications = getNotifications();
  if (!Notifications?.scheduleNotificationAsync) {
    return;
  }

  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Meal Reminder',
      body: `Reminder for your ${mealName} meal.`,
    },
    trigger: {
      type: 'date',
      date: triggerDate,
    },
  });
};
