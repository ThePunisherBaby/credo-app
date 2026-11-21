import 'package:flutter/material.dart';

class CredoColors {
  static const parchment = Color(0xFFFAF7F2);
  static const warmSurface = Color(0xFFFFFFFF);
  static const warmTint = Color(0xFFF3ECE1);
  static const hairline = Color(0xFFE6DDD0);
  static const cardinal = Color(0xFF7A1C2E);
  static const cardinalDark = Color(0xFF56111F);
  static const vaticanGold = Color(0xFFB8860B);
  static const vaticanGoldSoft = Color(0xFFFBF3DF);
  static const episcopalViolet = Color(0xFF6B2D5C);
  static const ink = Color(0xFF1F1B18);
  static const mutedInk = Color(0xFF655D56);
  static const tealFaithful = Color(0xFF236460);
}

Color parseHexColor(String hex, {Color fallback = CredoColors.cardinal}) {
  final cleaned = hex.replaceAll('#', '').trim();
  if (cleaned.length == 6) {
    final val = int.tryParse('FF$cleaned', radix: 16);
    if (val != null) return Color(val);
  }
  return fallback;
}

ThemeData buildCredoTheme() {
  final colorScheme = ColorScheme.fromSeed(
    seedColor: CredoColors.cardinal,
    brightness: Brightness.light,
    primary: CredoColors.cardinal,
    onPrimary: Colors.white,
    secondary: CredoColors.vaticanGold,
    onSecondary: Colors.white,
    tertiary: CredoColors.episcopalViolet,
    surface: CredoColors.warmSurface,
    onSurface: CredoColors.ink,
    outlineVariant: CredoColors.hairline,
  );

  const serifFallback = ['Georgia', 'Times New Roman', 'serif'];
  const sansFallback = ['Inter', 'Roboto', 'SF Pro Text', 'sans-serif'];

  const displayStyle = TextStyle(
    fontFamily: 'Cinzel',
    fontFamilyFallback: serifFallback,
    color: CredoColors.ink,
  );

  const bodyStyle = TextStyle(
    fontFamily: 'Plus Jakarta Sans',
    fontFamilyFallback: sansFallback,
    color: CredoColors.ink,
  );

  return ThemeData(
    useMaterial3: true,
    fontFamily: 'Plus Jakarta Sans',
    fontFamilyFallback: sansFallback,
    colorScheme: colorScheme,
    scaffoldBackgroundColor: CredoColors.parchment,
    textTheme: TextTheme(
      headlineLarge: displayStyle.copyWith(
        fontSize: 28,
        fontWeight: FontWeight.w700,
        letterSpacing: 0.4,
      ),
      headlineMedium: displayStyle.copyWith(
        fontSize: 22,
        fontWeight: FontWeight.w700,
        letterSpacing: 0.3,
      ),
      headlineSmall: displayStyle.copyWith(
        fontSize: 18,
        fontWeight: FontWeight.w600,
      ),
      titleLarge: bodyStyle.copyWith(
        fontSize: 18,
        fontWeight: FontWeight.w700,
      ),
      titleMedium: bodyStyle.copyWith(
        fontSize: 15,
        fontWeight: FontWeight.w600,
      ),
      bodyLarge: bodyStyle.copyWith(
        fontSize: 15,
        height: 1.55,
      ),
      bodyMedium: bodyStyle.copyWith(
        fontSize: 14,
        height: 1.48,
      ),
      bodySmall: bodyStyle.copyWith(
        fontSize: 12.5,
        color: CredoColors.mutedInk,
      ),
    ),
    appBarTheme: AppBarTheme(
      backgroundColor: CredoColors.warmSurface,
      foregroundColor: CredoColors.ink,
      elevation: 0,
      scrolledUnderElevation: 1,
      surfaceTintColor: Colors.transparent,
      titleTextStyle: displayStyle.copyWith(
        fontSize: 20,
        fontWeight: FontWeight.w700,
        color: CredoColors.cardinal,
        letterSpacing: 1.0,
      ),
    ),
    cardTheme: CardThemeData(
      color: CredoColors.warmSurface,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: const BorderSide(color: CredoColors.hairline),
      ),
    ),
    chipTheme: ChipThemeData(
      backgroundColor: CredoColors.warmTint,
      selectedColor: CredoColors.vaticanGoldSoft,
      checkmarkColor: CredoColors.cardinal,
      labelStyle: const TextStyle(
        fontSize: 13,
        fontWeight: FontWeight.w600,
        color: CredoColors.ink,
      ),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
      side: const BorderSide(color: CredoColors.hairline),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: CredoColors.parchment,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: CredoColors.hairline),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: CredoColors.hairline),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: CredoColors.cardinal, width: 1.6),
      ),
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: CredoColors.cardinal,
        foregroundColor: Colors.white,
        padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 13),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        textStyle: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: CredoColors.cardinal,
        side: const BorderSide(color: CredoColors.hairline),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        textStyle: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14),
      ),
    ),
    dividerTheme: const DividerThemeData(
      color: CredoColors.hairline,
      thickness: 1,
      space: 1,
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: CredoColors.warmSurface,
      indicatorColor: CredoColors.vaticanGoldSoft,
      labelTextStyle: WidgetStateProperty.resolveWith((states) {
        final selected = states.contains(WidgetState.selected);
        return TextStyle(
          fontSize: 11.5,
          fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
          color: selected ? CredoColors.cardinal : CredoColors.mutedInk,
        );
      }),
    ),
  );
}
