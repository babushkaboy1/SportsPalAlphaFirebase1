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
  switch(activity.toLowerCase()) {
    case "basketball":
      return <Ionicons name="basketball-outline" size={size} color={color} />;
    case "running":
      return <MaterialCommunityIcons name="run" size={size} color={color} />;
    case "soccer":
      return <Ionicons name="football-outline" size={size} color={color} />;
    case "gym":
      return <Ionicons name="barbell-outline" size={size} color={color} />;
    case "calisthenics":
      return <MaterialCommunityIcons name="weight-lifter" size={size} color={color} />;
    case "padel":
      return <Ionicons name="tennisball-outline" size={size} color={color} />;
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
    default:
      return <Ionicons name="help-circle-outline" size={size} color={color} />;
  }
};