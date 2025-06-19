import * as Notifications from 'expo-notifications';

// dateStr: "2025-06-18", timeStr: "18:00"
export const scheduleActivityNotifications = async (dateStr: string, timeStr: string) => {
  const [hour, minute] = timeStr.split(':').map(Number);
  const activityDate = new Date(dateStr);
  activityDate.setHours(hour, minute, 0, 0);

  const now = new Date();

  // Helper to get seconds from now to a target date
  const secondsUntil = (target: Date) => Math.floor((target.getTime() - now.getTime()) / 1000);

  // 8am notification (if joining before 8am)
  const eightAM = new Date(activityDate);
  eightAM.setHours(8, 0, 0, 0);
  if (now < eightAM) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: "Today's Activity Reminder",
        body: "You have an activity today! Get ready!",
        sound: true,
      },
      trigger: { seconds: secondsUntil(eightAM), channelId: 'default' },
    });
  }

  // 1 hour before notification
  const oneHourBefore = new Date(activityDate.getTime() - 60 * 60 * 1000);
  if (oneHourBefore > now) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: "Upcoming Activity",
        body: "Your activity starts in 1 hour!",
        sound: true,
      },
      trigger: { seconds: secondsUntil(oneHourBefore), channelId: 'default' },
    });
  }

  // 3 hours after notification
  const threeHoursAfter = new Date(activityDate.getTime() + 3 * 60 * 60 * 1000);
  if (threeHoursAfter > now) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: "How did it go?",
        body: "How was your activity? Tap to rate and share your experience!",
        sound: true,
      },
      trigger: { seconds: secondsUntil(threeHoursAfter), channelId: 'default' },
    });
  }
};