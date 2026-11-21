import 'package:flutter/material.dart';
import '../../../l10n/generated/app_localizations.dart';
import '../../../state/app_controller.dart';
import '../../core/labels.dart';
import '../../core/theme.dart';
import '../../core/widgets/rank_badge.dart';
import '../../core/widgets/user_avatar.dart';
import '../auth/auth_sheet.dart';
import '../directory/directory_view.dart';
import '../feed/compose_post_dialog.dart';
import '../feed/feed_view.dart';
import '../hierarchy/hierarchy_view.dart';
import '../hierarchy/unit_detail_view.dart';
import '../messages/messages_view.dart';
import '../profile/profile_view.dart';

class CredoShell extends StatefulWidget {
  const CredoShell({super.key, required this.controller});

  final AppController controller;

  @override
  State<CredoShell> createState() => _CredoShellState();
}

class _CredoShellState extends State<CredoShell> {
  int _tabIndex = 0;
  int? _pendingConversationId;

  void _openUnit(int unitId) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (ctx) => UnitDetailView(
          unitId: unitId,
          controller: widget.controller,
          onOpenUnit: _openUnit,
          onOpenProfile: _openProfile,
          onOpenPastoralGroup: (convId) {
            Navigator.of(ctx).popUntil((r) => r.isFirst);
            setState(() {
              _pendingConversationId = convId;
              _tabIndex = 3;
            });
          },
        ),
      ),
    );
  }

  void _openProfile(int userId) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (ctx) => ProfileView(
          userId: userId,
          controller: widget.controller,
          onOpenUnit: _openUnit,
          onOpenProfile: _openProfile,
          onStartChatWithUser: (targetId) async {
            final cid = await widget.controller.api.startDirectChat(targetId);
            if (!ctx.mounted) return;
            Navigator.of(ctx).popUntil((r) => r.isFirst);
            setState(() {
              _pendingConversationId = cid;
              _tabIndex = 3;
            });
          },
        ),
      ),
    );
  }

  Future<void> _openComposer() async {
    final created = await showComposePostDialog(
      context: context,
      controller: widget.controller,
    );
    if (created != null) {
      widget.controller.bumpDataVersion();
      await widget.controller.refreshGlobalData();
      setState(() => _tabIndex = 0);
    }
  }

  Widget _buildActiveTab(AppLocalizations l10n) {
    switch (_tabIndex) {
      case 0:
        return FeedView(
          controller: widget.controller,
          onOpenProfile: _openProfile,
          onOpenUnit: _openUnit,
        );
      case 1:
        return HierarchyView(
          controller: widget.controller,
          onOpenUnit: _openUnit,
        );
      case 2:
        return DirectoryView(
          controller: widget.controller,
          onOpenProfile: _openProfile,
          onOpenUnit: _openUnit,
        );
      case 3:
        return MessagesView(
          controller: widget.controller,
          onOpenProfile: _openProfile,
          initialConversationId: _pendingConversationId,
        );
      default:
        final me = widget.controller.currentUser;
        if (me == null) {
          return Center(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Card(
                child: Padding(
                  padding: const EdgeInsets.all(28),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.person_outline_rounded,
                          size: 48, color: CredoColors.cardinal),
                      const SizedBox(height: 12),
                      Text(
                        l10n.joinCredo,
                        style: Theme.of(context).textTheme.titleLarge,
                        textAlign: TextAlign.center,
                      ),
                      const SizedBox(height: 8),
                      Text(
                        l10n.layCannotPublishHint,
                        textAlign: TextAlign.center,
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                      const SizedBox(height: 18),
                      Wrap(
                        spacing: 10,
                        children: [
                          FilledButton(
                            onPressed: () => showAuthDialog(
                              context: context,
                              controller: widget.controller,
                            ),
                            child: Text(l10n.signIn),
                          ),
                          OutlinedButton(
                            onPressed: () => showAuthDialog(
                              context: context,
                              controller: widget.controller,
                              initialRegister: true,
                            ),
                            child: Text(l10n.register),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            ),
          );
        }
        return ProfileView(
          userId: me.id,
          controller: widget.controller,
          onOpenUnit: _openUnit,
          onOpenProfile: _openProfile,
          onStartChatWithUser: (_) {},
          embedded: true,
        );
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final width = MediaQuery.of(context).size.width;
    final isDesktop = width >= 900;
    final showRightRail = width >= 1260 && _tabIndex != 3;
    final user = widget.controller.currentUser;

    final navItems = <(IconData, IconData, String)>[
      (Icons.auto_stories_outlined, Icons.auto_stories_rounded, l10n.navFeed),
      (Icons.account_tree_outlined, Icons.account_tree_rounded,
          l10n.navHierarchy),
      (Icons.public_outlined, Icons.public_rounded, l10n.navDirectory),
      (Icons.forum_outlined, Icons.forum_rounded, l10n.navMessages),
      (Icons.person_outline_rounded, Icons.person_rounded, l10n.navProfile),
    ];

    if (isDesktop) {
      return Scaffold(
        body: Row(
          children: [
            // Permanent Desktop Left Sidebar
            SizedBox(
              width: 260,
              child: Material(
                color: CredoColors.warmSurface,
                shape: const Border(
                  right: BorderSide(color: CredoColors.hairline),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Padding(
                      padding: const EdgeInsets.fromLTRB(20, 22, 20, 14),
                      child: Row(
                        children: [
                          Container(
                            width: 40,
                            height: 40,
                            decoration: BoxDecoration(
                              color: CredoColors.cardinal,
                              borderRadius: BorderRadius.circular(12),
                            ),
                            child: const Icon(Icons.add_rounded,
                                color: CredoColors.vaticanGoldSoft, size: 24),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  l10n.appTitle,
                                  style: Theme.of(context)
                                      .textTheme
                                      .headlineSmall
                                      ?.copyWith(color: CredoColors.cardinal),
                                ),
                                Text(
                                  l10n.appSubtitle,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: Theme.of(context).textTheme.bodySmall,
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                    const Divider(),
                    const SizedBox(height: 8),
                    for (int i = 0; i < navItems.length; i++)
                      Padding(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 12, vertical: 2),
                        child: ListTile(
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(12),
                          ),
                          selected: _tabIndex == i,
                          selectedTileColor: CredoColors.vaticanGoldSoft,
                          leading: Icon(
                            _tabIndex == i ? navItems[i].$2 : navItems[i].$1,
                            color: _tabIndex == i
                                ? CredoColors.cardinal
                                : CredoColors.mutedInk,
                          ),
                          title: Text(
                            navItems[i].$3,
                            style: TextStyle(
                              fontWeight: _tabIndex == i
                                  ? FontWeight.w700
                                  : FontWeight.w500,
                              color: _tabIndex == i
                                  ? CredoColors.cardinal
                                  : CredoColors.ink,
                            ),
                          ),
                          onTap: () => setState(() => _tabIndex = i),
                        ),
                      ),
                    if (widget.controller.canPublish) ...[
                      Padding(
                        padding: const EdgeInsets.fromLTRB(16, 14, 16, 6),
                        child: FilledButton.icon(
                          onPressed: _openComposer,
                          icon: const Icon(Icons.edit_note_rounded),
                          label: Text(l10n.newPublication),
                        ),
                      ),
                    ],
                    const Spacer(),
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      child: _LanguageDropdown(controller: widget.controller),
                    ),
                    const SizedBox(height: 10),
                    const Divider(),
                    Padding(
                      padding: const EdgeInsets.all(14),
                      child: user != null
                          ? InkWell(
                              onTap: () => setState(() => _tabIndex = 4),
                              borderRadius: BorderRadius.circular(12),
                              child: Row(
                                children: [
                                  UserAvatar(user: user, radius: 20),
                                  const SizedBox(width: 10),
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: [
                                        Text(
                                          user.displayName,
                                          maxLines: 1,
                                          overflow: TextOverflow.ellipsis,
                                          style: const TextStyle(
                                            fontWeight: FontWeight.w700,
                                            fontSize: 13.5,
                                          ),
                                        ),
                                        const SizedBox(height: 2),
                                        RankBadge(
                                          rank: user.ecclesiasticalRank,
                                          isVerified: user.isVerified,
                                          compact: true,
                                        ),
                                      ],
                                    ),
                                  ),
                                ],
                              ),
                            )
                          : FilledButton.icon(
                              onPressed: () => showAuthDialog(
                                context: context,
                                controller: widget.controller,
                              ),
                              icon: const Icon(Icons.login_rounded, size: 18),
                              label: Text(l10n.signIn),
                            ),
                    ),
                  ],
                ),
              ),
            ),

            // Center Content Area
            Expanded(
              child: _tabIndex == 3
                  ? _buildActiveTab(l10n)
                  : Center(
                      child: ConstrainedBox(
                        constraints: const BoxConstraints(maxWidth: 780),
                        child: _buildActiveTab(l10n),
                      ),
                    ),
            ),

            // Optional Right Context Rail on Wide Screens
            if (showRightRail)
              SizedBox(
                width: 300,
                child: Material(
                  color: CredoColors.warmSurface,
                  shape: const Border(
                    left: BorderSide(color: CredoColors.hairline),
                  ),
                  child: ListView(
                    padding: const EdgeInsets.all(18),
                    children: [
                      Text(
                        l10n.worldwideHierarchy,
                        style: Theme.of(context).textTheme.titleMedium?.copyWith(
                              color: CredoColors.cardinal,
                            ),
                      ),
                      const SizedBox(height: 10),
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 10, vertical: 14),
                        decoration: BoxDecoration(
                          color: CredoColors.parchment,
                          borderRadius: BorderRadius.circular(14),
                          border: Border.all(color: CredoColors.hairline),
                        ),
                        child: Row(
                          children: [
                            Expanded(
                              child: _MiniStat(
                                value: '${widget.controller.stats.units}',
                                label: l10n.unitsCount,
                              ),
                            ),
                            Expanded(
                              child: _MiniStat(
                                value: '${widget.controller.stats.countries}',
                                label: l10n.countriesCount,
                              ),
                            ),
                            Expanded(
                              child: _MiniStat(
                                value: '${widget.controller.stats.clergy}',
                                label: l10n.clergyCount,
                              ),
                            ),
                          ],
                        ),
                      ),
                    const SizedBox(height: 18),
                    for (final u in widget.controller.allUnits.where((u) =>
                        u.unitType == 'holy_see' ||
                        u.unitType == 'episcopal_conference' ||
                        u.unitType == 'religious_order').take(12)) ...[
                      ListTile(
                        dense: true,
                        contentPadding: const EdgeInsets.symmetric(
                            horizontal: 8, vertical: 0),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(10),
                        ),
                        leading: Text(
                          countryFlag(u.countryCode),
                          style: const TextStyle(fontSize: 18),
                        ),
                        title: Text(
                          u.name,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        subtitle: Text(
                          unitTypeLabel(l10n, u.unitType),
                          style: const TextStyle(fontSize: 11.5),
                        ),
                        onTap: () => _openUnit(u.id),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ],
        ),
      );
    }

    // Mobile / Compact Layout
    return Scaffold(
      appBar: AppBar(
        title: Row(
          children: [
            Container(
              width: 30,
              height: 30,
              decoration: BoxDecoration(
                color: CredoColors.cardinal,
                borderRadius: BorderRadius.circular(8),
              ),
              child: const Icon(Icons.add_rounded,
                  color: CredoColors.vaticanGoldSoft, size: 19),
            ),
            const SizedBox(width: 9),
            Text(l10n.appTitle),
          ],
        ),
        actions: [
          PopupMenuButton<String>(
            tooltip: l10n.language,
            icon: const Icon(Icons.translate_rounded),
            onSelected: widget.controller.setLocale,
            itemBuilder: (ctx) => AppController.supportedLanguageCodes
                .map(
                  (code) => PopupMenuItem<String>(
                    value: code,
                    child: Row(
                      children: [
                        if (widget.controller.locale.languageCode == code)
                          const Icon(Icons.check_rounded,
                              size: 16, color: CredoColors.cardinal)
                        else
                          const SizedBox(width: 16),
                        const SizedBox(width: 8),
                        Text(languageDisplayName(code)),
                      ],
                    ),
                  ),
                )
                .toList(),
          ),
          if (user != null)
            Padding(
              padding: const EdgeInsets.only(right: 12),
              child: GestureDetector(
                onTap: () => setState(() => _tabIndex = 4),
                child: UserAvatar(user: user, radius: 16, showBadge: false),
              ),
            )
          else
            TextButton(
              onPressed: () => showAuthDialog(
                context: context,
                controller: widget.controller,
              ),
              child: Text(l10n.signIn),
            ),
        ],
      ),
      body: _buildActiveTab(l10n),
      floatingActionButton: widget.controller.canPublish && _tabIndex == 0
          ? FloatingActionButton.extended(
              backgroundColor: CredoColors.cardinal,
              foregroundColor: Colors.white,
              onPressed: _openComposer,
              icon: const Icon(Icons.edit_note_rounded),
              label: Text(l10n.publish),
            )
          : null,
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tabIndex,
        onDestinationSelected: (i) => setState(() => _tabIndex = i),
        destinations: navItems
            .map(
              (item) => NavigationDestination(
                icon: Icon(item.$1),
                selectedIcon: Icon(item.$2, color: CredoColors.cardinal),
                label: item.$3,
              ),
            )
            .toList(),
      ),
    );
  }
}

class _LanguageDropdown extends StatelessWidget {
  const _LanguageDropdown({required this.controller});
  final AppController controller;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return InputDecorator(
      decoration: InputDecoration(
        labelText: l10n.language,
        prefixIcon: const Icon(Icons.translate_rounded, size: 18),
        contentPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      ),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<String>(
          isDense: true,
          value: controller.locale.languageCode,
          items: AppController.supportedLanguageCodes
              .map(
                (code) => DropdownMenuItem(
                  value: code,
                  child: Text(languageDisplayName(code)),
                ),
              )
              .toList(),
          onChanged: (v) {
            if (v != null) controller.setLocale(v);
          },
        ),
      ),
    );
  }
}

class _MiniStat extends StatelessWidget {
  const _MiniStat({required this.value, required this.label});
  final String value;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Text(
          value,
          style: const TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.w800,
            color: CredoColors.cardinal,
          ),
        ),
        Text(
          label,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: Theme.of(context).textTheme.bodySmall,
        ),
      ],
    );
  }
}
