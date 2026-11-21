import 'package:flutter/material.dart';
import '../../l10n/generated/app_localizations.dart';

const kClergyRanks = [
  'cardinal',
  'archbishop',
  'bishop',
  'monsignor',
  'priest',
  'deacon',
];

const kAllSelectableRanks = [
  'cardinal',
  'archbishop',
  'bishop',
  'monsignor',
  'priest',
  'deacon',
  'religious',
  'seminarian',
  'catechist',
  'lay',
];

const kUnitTypes = [
  'holy_see',
  'dicastery',
  'episcopal_conference',
  'archdiocese',
  'diocese',
  'vicariate',
  'parish',
  'religious_order',
  'seminary',
];

const kPostTypes = [
  'homily',
  'pastoral_letter',
  'announcement',
  'decree',
  'reflection',
  'event',
];

bool isClergyRankCode(String rank) {
  return rank == 'pope' || kClergyRanks.contains(rank);
}

String rankLabel(AppLocalizations l10n, String rank) {
  switch (rank) {
    case 'pope':
      return l10n.rankPope;
    case 'cardinal':
      return l10n.rankCardinal;
    case 'archbishop':
      return l10n.rankArchbishop;
    case 'bishop':
      return l10n.rankBishop;
    case 'monsignor':
      return l10n.rankMonsignor;
    case 'priest':
      return l10n.rankPriest;
    case 'deacon':
      return l10n.rankDeacon;
    case 'religious':
      return l10n.rankReligious;
    case 'seminarian':
      return l10n.rankSeminarian;
    case 'catechist':
      return l10n.rankCatechist;
    default:
      return l10n.rankLay;
  }
}

Color rankColor(String rank) {
  switch (rank) {
    case 'pope':
      return const Color(0xFFB8860B);
    case 'cardinal':
      return const Color(0xFF9B1C2E);
    case 'archbishop':
    case 'bishop':
      return const Color(0xFF6B2D5C);
    case 'monsignor':
      return const Color(0xFF8E3A59);
    case 'priest':
      return const Color(0xFF2C3038);
    case 'deacon':
      return const Color(0xFF355070);
    case 'religious':
      return const Color(0xFF6B4C35);
    case 'seminarian':
      return const Color(0xFF4A5568);
    case 'catechist':
      return const Color(0xFF2B6CB0);
    default:
      return const Color(0xFF236460);
  }
}

String unitTypeLabel(AppLocalizations l10n, String type) {
  switch (type) {
    case 'holy_see':
      return l10n.unitHolySee;
    case 'dicastery':
      return l10n.unitDicastery;
    case 'episcopal_conference':
      return l10n.unitEpiscopalConference;
    case 'archdiocese':
      return l10n.unitArchdiocese;
    case 'diocese':
      return l10n.unitDiocese;
    case 'vicariate':
      return l10n.unitVicariate;
    case 'parish':
      return l10n.unitParish;
    case 'religious_order':
      return l10n.unitReligiousOrder;
    case 'seminary':
      return l10n.unitSeminary;
    default:
      return type;
  }
}

IconData unitTypeIcon(String type) {
  switch (type) {
    case 'holy_see':
      return Icons.account_balance_rounded;
    case 'dicastery':
      return Icons.gavel_rounded;
    case 'episcopal_conference':
      return Icons.public_rounded;
    case 'archdiocese':
      return Icons.location_city_rounded;
    case 'diocese':
      return Icons.church_rounded;
    case 'vicariate':
      return Icons.hub_rounded;
    case 'parish':
      return Icons.home_work_rounded;
    case 'religious_order':
      return Icons.auto_stories_rounded;
    case 'seminary':
      return Icons.school_rounded;
    default:
      return Icons.church_rounded;
  }
}

String postTypeLabel(AppLocalizations l10n, String type) {
  switch (type) {
    case 'homily':
      return l10n.postTypeHomily;
    case 'pastoral_letter':
      return l10n.postTypePastoralLetter;
    case 'announcement':
      return l10n.postTypeAnnouncement;
    case 'decree':
      return l10n.postTypeDecree;
    case 'event':
      return l10n.postTypeEvent;
    default:
      return l10n.postTypeReflection;
  }
}

IconData postTypeIcon(String type) {
  switch (type) {
    case 'homily':
      return Icons.menu_book_rounded;
    case 'pastoral_letter':
      return Icons.mark_email_read_rounded;
    case 'announcement':
      return Icons.campaign_rounded;
    case 'decree':
      return Icons.verified_rounded;
    case 'event':
      return Icons.event_rounded;
    default:
      return Icons.auto_awesome_rounded;
  }
}

Color postTypeColor(String type) {
  switch (type) {
    case 'homily':
      return const Color(0xFF7A1C2E);
    case 'pastoral_letter':
      return const Color(0xFF6B2D5C);
    case 'announcement':
      return const Color(0xFF1E4E79);
    case 'decree':
      return const Color(0xFFB8860B);
    case 'event':
      return const Color(0xFF1F6F43);
    default:
      return const Color(0xFF4A5568);
  }
}

String countryFlag(String code) {
  final upper = code.trim().toUpperCase();
  if (upper.length != 2) return '🌍';
  final first = upper.codeUnitAt(0) - 0x41 + 0x1F1E6;
  final second = upper.codeUnitAt(1) - 0x41 + 0x1F1E6;
  if (first < 0x1F1E6 || second < 0x1F1E6) return '🌍';
  return String.fromCharCodes([first, second]);
}

String languageDisplayName(String code) {
  switch (code) {
    case 'es':
      return 'Español';
    case 'en':
      return 'English';
    case 'it':
      return 'Italiano';
    case 'pt':
      return 'Português';
    case 'fr':
      return 'Français';
    default:
      return code.toUpperCase();
  }
}

String formatRelativeTime(DateTime dt) {
  final diff = DateTime.now().difference(dt.toLocal());
  if (diff.inMinutes < 1) return 'ahora';
  if (diff.inMinutes < 60) return '${diff.inMinutes}m';
  if (diff.inHours < 24) return '${diff.inHours}h';
  if (diff.inDays < 7) return '${diff.inDays}d';
  return '${dt.day.toString().padLeft(2, '0')}/${dt.month.toString().padLeft(2, '0')}/${dt.year}';
}
