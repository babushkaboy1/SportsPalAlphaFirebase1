// ActivityIcons.tsx
import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { MaterialCommunityIcons } from '@expo/vector-icons';

type ActivityIconProps = {
  activity: string;
  size?: number;
  color?: string;
};

export const ActivityIcon = ({
  activity,
  size = 32,
  color = "#1ae9ef",
}: ActivityIconProps) => {
  const activityLower = String(activity || '').toLowerCase().trim();
  
  switch(activityLower) {
    case "basketball":
      return <Ionicons name="basketball-outline" size={size} color={color} />;
    case "running":
      return <MaterialCommunityIcons name="run" size={size} color={color} />;
    case "soccer":
      return <Ionicons name="football-outline" size={size} color={color} />;
    case "hiking":
      return <MaterialCommunityIcons name="hiking" size={size} color={color} />;
    case "gym":
      return <Ionicons name="barbell-outline" size={size} color={color} />;
    case "calisthenics":
      return <MaterialCommunityIcons name="weight-lifter" size={size} color={color} />;
    case "padel":
      // Use racquetball icon for Padel to differentiate from tennis
      return <MaterialCommunityIcons name="racquetball" size={size} color={color} />;
    case "tennis":
      return <Ionicons name="tennisball-outline" size={size} color={color} />;
    case "cycling":
      return <MaterialCommunityIcons name="bike" size={size} color={color} />;
    case "swimming":
      return <MaterialCommunityIcons name="swim" size={size} color={color} />;
    case "badminton":
      return <MaterialCommunityIcons name="badminton" size={size} color={color} />;
    case "volleyball":
      return <MaterialCommunityIcons name="volleyball" size={size} color={color} />;
    case "table tennis":
    case "table-tennis":
      return <MaterialCommunityIcons name="table-tennis" size={size} color={color} />;
    case "boxing":
      // Flip the boxing glove horizontally so it faces right
      return (
        <MaterialCommunityIcons
          name="boxing-glove"
          size={size}
          color={color}
          style={{ transform: [{ scaleX: -1 }] }}
        />
      );
    case "yoga":
      return <MaterialCommunityIcons name="yoga" size={size} color={color} />;
    case "martial arts":
    case "karate":
      return <MaterialCommunityIcons name="karate" size={size} color={color} />;
    case "american football":
    case "american-football":
      // Use the american-football ball icon (Ionicons) rather than a helmet
      return <Ionicons name="american-football" size={size} color={color} />;
    case "cricket":
      return <MaterialCommunityIcons name="cricket" size={size} color={color} />;
    case "golf":
      return <Ionicons name="golf-outline" size={size} color={color} />;
    case "baseball":
      return <MaterialCommunityIcons name="baseball" size={size} color={color} />;
    case "field hockey":
    case "field-hockey":
      return <MaterialCommunityIcons name="hockey-sticks" size={size} color={color} />;
    case "ice hockey":
    case "ice-hockey":
      return <MaterialCommunityIcons name="hockey-puck" size={size} color={color} />;
    default:
      return <Ionicons name="help-circle-outline" size={size} color={color} />;
  }
};