export type Activity = {
  id: string;
  activity: string;
  location: string;
  creator: string;
  creatorId?: string;
  creatorUsername?: string;
  date: string;
  time: string;
  distance: number;
  maxParticipants: number;
  joinedCount: number;
  joined?: boolean;
  isJoined?: boolean;
  latitude: number;
  longitude: number;
  joinedUserIds?: string[];
};

export const activities: Activity[] = [
  {
    id: "1",
    activity: "Basketball",
    location: "Downtown Court",
    creator: "Alice",
      date: "01-06-2025", // dd-mm-yyyy format
    time: "18:00",
    distance: 2.5,
    latitude: 37.9838,
    longitude: 23.7275,
    joinedCount: 3,
    maxParticipants: 10,
    joined: false,
  },
  {
    id: "2",
    activity: "Soccer",
    location: "Local Field",
    creator: "Bob",
      date: "02-06-2025",
    time: "16:00",
    distance: 3.2,
    latitude: 37.9750,
    longitude: 23.7340,
    joinedCount: 4,
    maxParticipants: 11,
    joined: false,
  },
  {
    id: "3",
    activity: "Running",
    location: "Central Park",
    creator: "Charlie",
      date: "03-06-2025",
    time: "07:00",
    distance: 1.8,
    latitude: 37.9900,
    longitude: 23.7300,
    joinedCount: 5,
    maxParticipants: 20,
    joined: false,
  },
  {
    id: "4",
    activity: "Gym",
    location: "Fitness Center",
    creator: "Dave",
      date: "04-06-2025",
    time: "10:00",
    distance: 4.0,
    latitude: 37.9800,
    longitude: 23.7200,
    joinedCount: 2,
    maxParticipants: 15,
    joined: false,
  },
  {
    id: "5",
    activity: "Calisthenics",
    location: "Street Workout",
    creator: "Eve",
      date: "05-06-2025",
    time: "15:00",
    distance: 2.2,
    latitude: 37.9850,
    longitude: 23.7500,
    joinedCount: 1,
    maxParticipants: 12,
    joined: false,
  },
  {
    id: "6",
    activity: "Padel",
    location: "Country Club",
    creator: "Frank",
      date: "06-06-2025",
    time: "12:00",
    distance: 3.0,
    latitude: 37.9700,
    longitude: 23.7400,
    joinedCount: 6,
    maxParticipants: 8,
    joined: false,
  },
  {
    id: "7",
    activity: "Tennis",
    location: "Community Club",
    creator: "Grace",
      date: "07-06-2025",
    time: "14:00",
    distance: 2.1,
    latitude: 37.9950,
    longitude: 23.7350,
    joinedCount: 0,
    maxParticipants: 4,
    joined: false,
  },
  {
    id: "8",
    activity: "Cycling",
    location: "City Trail",
    creator: "Hank",
      date: "08-06-2025",
    time: "08:00",
    distance: 5.3,
    latitude: 37.9900,
    longitude: 23.7200,
    joinedCount: 10,
    maxParticipants: 30,
    joined: false,
  },
  {
    id: "9",
    activity: "Swimming",
    location: "Aquatic Center",
    creator: "Ivan",
      date: "09-06-2025",
    time: "09:00",
    distance: 1.5,
    latitude: 37.9755,
    longitude: 23.7100,
    joinedCount: 3,
    maxParticipants: 12,
    joined: false,
  },
  {
    id: "10",
    activity: "Badminton",
    location: "Recreation Hall",
    creator: "Jill",
      date: "10-06-2025",
    time: "17:00",
    distance: 2.8,
    latitude: 37.9805,
    longitude: 23.7250,
    joinedCount: 2,
    maxParticipants: 8,
    joined: false,
  },
  {
    id: "11",
    activity: "Volleyball",
    location: "Beach Court",
    creator: "Kevin",
      date: "11-06-2025",
    time: "11:00",
    distance: 3.5,
    latitude: 37.9705,
    longitude: 23.7150,
    joinedCount: 4,
    maxParticipants: 6,
    joined: false,
  },
];

activities.forEach((activity) => {
  activity.date = normalizeDateFormat(activity.date); // Normalize date format
});

function normalizeDateFormat(date: string): string {
  // If the date is already in yyyy-mm-dd format, return it
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return date;
  }

  // Convert from dd-mm-yyyy to yyyy-mm-dd
  const parts = date.split('-');
  if (parts.length === 3) {
    const [dd, mm, yyyy] = parts;
    return `${yyyy}-${mm}-${dd}`;
  }

  // Return the original date if it doesn't match any known format
  console.warn(`Unrecognized date format: ${date}`);
  return date;
}
