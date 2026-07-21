// App.tsx — HSMC Pay main entry point with LockScreen + bottom tab navigation

import React, { useState } from 'react';
import { StatusBar, Platform } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import LockScreen from './src/screens/LockScreen';
import WalletScreen from './src/screens/WalletScreen';
import PayScreen from './src/screens/PayScreen';
import ATMScreen from './src/screens/ATMScreen';
import HistoryScreen from './src/screens/HistoryScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import { Colors, FontSizes } from './src/theme/colors';

const Tab = createBottomTabNavigator();

// Glassmorphism dark theme for Navigation Container
const HSMCTheme = {
  ...DefaultTheme,
  dark: true,
  colors: {
    ...DefaultTheme.colors,
    primary: Colors.primary,
    background: Colors.background,
    card: Colors.glass,
    text: Colors.text,
    border: Colors.glassBorder,
    notification: Colors.primary,
  },
};

function MainApp() {
  return (
    <NavigationContainer theme={HSMCTheme}>
      <StatusBar
        barStyle="light-content"
        backgroundColor={Colors.background}
        translucent={false}
      />
      <Tab.Navigator
        screenOptions={({ route }) => ({
          tabBarIcon: ({ focused, color, size }) => {
            let iconName: string;
            switch (route.name) {
              case 'Wallet':
                iconName = focused ? 'wallet' : 'wallet-outline';
                break;
              case 'Pay':
                iconName = focused ? 'contactless-payment' : 'contactless-payment';
                break;
              case 'ATM':
                iconName = focused ? 'bank' : 'bank-outline';
                break;
              case 'History':
                iconName = focused ? 'clipboard-text-clock' : 'clipboard-text-clock-outline';
                break;
              case 'Settings':
                iconName = focused ? 'cog' : 'cog-outline';
                break;
              default:
                iconName = 'circle';
            }
            return <Icon name={iconName} size={size} color={color} />;
          },
          tabBarActiveTintColor: Colors.primary,
          tabBarInactiveTintColor: Colors.textMuted,
          tabBarStyle: {
            backgroundColor: Colors.background,
            borderTopColor: Colors.glassBorder,
            borderTopWidth: 1,
            height: Platform.OS === 'android' ? 64 : 88,
            paddingBottom: Platform.OS === 'android' ? 8 : 28,
            paddingTop: 8,
          },
          tabBarLabelStyle: {
            fontSize: FontSizes.xs,
            fontWeight: '600',
          },
          headerStyle: {
            backgroundColor: Colors.background,
            shadowColor: 'transparent',
            elevation: 0,
          },
          headerTintColor: Colors.text,
          headerTitleStyle: {
            fontWeight: '700',
            fontSize: FontSizes.lg,
          },
        })}
      >
        <Tab.Screen
          name="Wallet"
          component={WalletScreen}
          options={{ headerTitle: 'Wallet' }}
        />
        <Tab.Screen
          name="Pay"
          component={PayScreen}
          options={{ headerTitle: 'Pay' }}
        />
        <Tab.Screen
          name="ATM"
          component={ATMScreen}
          options={{ headerTitle: 'ATM' }}
        />
        <Tab.Screen
          name="History"
          component={HistoryScreen}
          options={{ headerTitle: 'History' }}
        />
        <Tab.Screen
          name="Settings"
          component={SettingsScreen}
          options={{ headerTitle: 'Settings' }}
        />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  const [isUnlocked, setIsUnlocked] = useState(false);

  if (!isUnlocked) {
    return <LockScreen onUnlock={() => setIsUnlocked(true)} />;
  }

  return <MainApp />;
}
