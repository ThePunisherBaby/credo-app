import 'dart:async';
import 'package:flutter/material.dart';
import '../../../domain/models/conversation.dart';
import '../../../domain/models/ecclesiastical_unit.dart';
import '../../../l10n/generated/app_localizations.dart';
import '../../../state/app_controller.dart';
import '../../core/labels.dart';
import '../../core/theme.dart';
import '../../core/widgets/rank_badge.dart';
import '../../core/widgets/unit_picker_dialog.dart';
import '../../core/widgets/user_avatar.dart';
import '../auth/auth_sheet.dart';

class MessagesView extends StatefulWidget {
  const MessagesView({
    super.key,
    required this.controller,
    required this.onOpenProfile,
    this.initialConversationId,
  });

  final AppController controller;
  final void Function(int userId) onOpenProfile;
  final int? initialConversationId;

  @override
  State<MessagesView> createState() => _MessagesViewState();
}

class _MessagesViewState extends State<MessagesView>
    with SingleTickerProviderStateMixin {
  late final TabController _tabCtrl;
  List<CredoConversation> _conversations = const [];
  List<CredoConversation> _discoverGroups = const [];
  CredoConversation? _activeConversation;
  List<CredoMessage> _messages = const [];

  bool _loadingList = true;
  bool _loadingMessages = false;
  bool _sending = false;
  Timer? _pollTimer;
  final _msgCtrl = TextEditingController();
  final _scrollCtrl = ScrollController();

  @override
  void initState() {
    super.initState();
    _tabCtrl = TabController(length: 2, vsync: this);
    widget.controller.addListener(_onAuthChanged);
    _loadConversations(selectId: widget.initialConversationId);
    _pollTimer = Timer.periodic(const Duration(seconds: 4), (_) {
      if (_activeConversation != null && widget.controller.isAuthenticated) {
        _loadMessages(_activeConversation!.id, silent: true);
      }
    });
  }

  @override
  void didUpdateWidget(covariant MessagesView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.initialConversationId != null &&
        widget.initialConversationId != oldWidget.initialConversationId) {
      _loadConversations(selectId: widget.initialConversationId);
    }
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    widget.controller.removeListener(_onAuthChanged);
    _tabCtrl.dispose();
    _msgCtrl.dispose();
    _scrollCtrl.dispose();
    super.dispose();
  }

  void _onAuthChanged() {
    if (widget.controller.isAuthenticated) {
      _loadConversations();
    } else {
      setState(() {
        _conversations = const [];
        _discoverGroups = const [];
        _activeConversation = null;
        _messages = const [];
      });
    }
  }

  Future<void> _loadConversations({int? selectId}) async {
    if (!widget.controller.isAuthenticated) {
      setState(() => _loadingList = false);
      return;
    }
    setState(() => _loadingList = true);
    try {
      final results = await Future.wait([
        widget.controller.api.fetchConversations(),
        widget.controller.api.discoverPastoralGroups(),
      ]);
      if (!mounted) return;
      final convs = results[0];
      final groups = results[1];
      setState(() {
        _conversations = convs;
        _discoverGroups = groups;
        _loadingList = false;
      });
      if (selectId != null) {
        final found = convs.where((c) => c.id == selectId).firstOrNull ??
            groups.where((g) => g.id == selectId).firstOrNull;
        if (found != null) {
          _openConversation(found);
        }
      }
    } catch (_) {
      if (mounted) setState(() => _loadingList = false);
    }
  }

  Future<void> _openConversation(CredoConversation conv) async {
    setState(() {
      _activeConversation = conv;
      _loadingMessages = true;
    });
    if (!conv.isMember && conv.isGroup) {
      try {
        await widget.controller.api.joinGroup(conv.id);
      } catch (_) {}
    }
    await _loadMessages(conv.id);
  }

  Future<void> _loadMessages(int conversationId, {bool silent = false}) async {
    if (!silent) setState(() => _loadingMessages = true);
    try {
      final list = await widget.controller.api.fetchMessages(conversationId);
      if (mounted && _activeConversation?.id == conversationId) {
        setState(() {
          _messages = list;
          _loadingMessages = false;
        });
      }
    } catch (_) {
      if (mounted && !silent) setState(() => _loadingMessages = false);
    }
  }

  Future<void> _sendMessage() async {
    final conv = _activeConversation;
    final text = _msgCtrl.text.trim();
    if (conv == null || text.isEmpty || _sending) return;
    setState(() => _sending = true);
    try {
      final msg = await widget.controller.api.sendMessage(conv.id, text);
      _msgCtrl.clear();
      setState(() => _messages = [..._messages, msg]);
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (_scrollCtrl.hasClients) {
          _scrollCtrl.animateTo(
            _scrollCtrl.position.maxScrollExtent,
            duration: const Duration(milliseconds: 220),
            curve: Curves.easeOut,
          );
        }
      });
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _createGroupDialog() async {
    final l10n = AppLocalizations.of(context);
    final titleCtrl = TextEditingController();
    final descCtrl = TextEditingController();
    EcclesiasticalUnit? unit = widget.controller.currentUser?.primaryUnit;

    final created = await showDialog<CredoConversation>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setModalState) => AlertDialog(
          title: Text(l10n.newPastoralGroup),
          content: SizedBox(
            width: 440,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: titleCtrl,
                  decoration: InputDecoration(labelText: l10n.groupTitle),
                ),
                const SizedBox(height: 10),
                TextField(
                  controller: descCtrl,
                  maxLines: 2,
                  decoration: InputDecoration(labelText: l10n.groupDescription),
                ),
                const SizedBox(height: 10),
                InkWell(
                  onTap: () async {
                    final u = await showUnitPickerDialog(
                      context: ctx,
                      units: widget.controller.allUnits,
                      selectedUnitId: unit?.id,
                    );
                    if (u != null) setModalState(() => unit = u);
                  },
                  child: InputDecorator(
                    decoration: InputDecoration(
                      labelText: l10n.targetScope,
                      suffixIcon: const Icon(Icons.search_rounded),
                    ),
                    child: Text(unit?.name ?? '—'),
                  ),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(),
              child: Text(l10n.cancel),
            ),
            FilledButton(
              onPressed: () async {
                if (titleCtrl.text.trim().isEmpty) return;
                final g = await widget.controller.api.createPastoralGroup(
                  title: titleCtrl.text.trim(),
                  description: descCtrl.text.trim(),
                  unitId: unit?.id,
                );
                if (ctx.mounted) Navigator.of(ctx).pop(g);
              },
              child: Text(l10n.save),
            ),
          ],
        ),
      ),
    );

    if (created != null) {
      await _loadConversations(selectId: created.id);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);

    if (!widget.controller.isAuthenticated) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Card(
            child: Padding(
              padding: const EdgeInsets.all(28),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.forum_outlined,
                      size: 46, color: CredoColors.cardinal),
                  const SizedBox(height: 12),
                  Text(l10n.messagesTitle,
                      style: Theme.of(context).textTheme.titleLarge),
                  const SizedBox(height: 6),
                  Text(l10n.signInRequired,
                      style: Theme.of(context).textTheme.bodySmall),
                  const SizedBox(height: 16),
                  FilledButton(
                    onPressed: () => showAuthDialog(
                      context: context,
                      controller: widget.controller,
                    ),
                    child: Text(l10n.signIn),
                  ),
                ],
              ),
            ),
          ),
        ),
      );
    }

    final isWide = MediaQuery.of(context).size.width >= 900;

    if (isWide) {
      return Row(
        children: [
          SizedBox(width: 340, child: _buildListPane(context, l10n)),
          const VerticalDivider(width: 1),
          Expanded(
            child: _activeConversation != null
                ? _buildChatPane(context, l10n, showBack: false)
                : Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.chat_bubble_outline_rounded,
                            size: 48, color: CredoColors.mutedInk),
                        const SizedBox(height: 12),
                        Text(l10n.messagesTitle,
                            style: Theme.of(context).textTheme.titleMedium),
                      ],
                    ),
                  ),
          ),
        ],
      );
    }

    // Mobile stacked view
    if (_activeConversation != null) {
      return _buildChatPane(context, l10n, showBack: true);
    }
    return _buildListPane(context, l10n);
  }

  Widget _buildListPane(BuildContext context, AppLocalizations l10n) {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 14, 12, 4),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  l10n.messagesTitle,
                  style: Theme.of(context).textTheme.titleLarge,
                ),
              ),
              IconButton(
                tooltip: l10n.newPastoralGroup,
                onPressed: _createGroupDialog,
                icon: const Icon(Icons.group_add_rounded,
                    color: CredoColors.cardinal),
              ),
            ],
          ),
        ),
        TabBar(
          controller: _tabCtrl,
          labelColor: CredoColors.cardinal,
          indicatorColor: CredoColors.cardinal,
          tabs: [
            Tab(text: l10n.myChats),
            Tab(text: l10n.discoverGroups),
          ],
        ),
        Expanded(
          child: _loadingList
              ? const Center(child: CircularProgressIndicator())
              : TabBarView(
                  controller: _tabCtrl,
                  children: [
                    _conversations.isEmpty
                        ? Center(
                            child: Padding(
                              padding: const EdgeInsets.all(24),
                              child: Text(
                                l10n.noConversationsYet,
                                textAlign: TextAlign.center,
                              ),
                            ),
                          )
                        : ListView.separated(
                            padding: const EdgeInsets.all(10),
                            itemCount: _conversations.length,
                            separatorBuilder: (_, _) =>
                                const SizedBox(height: 6),
                            itemBuilder: (ctx, i) {
                              final c = _conversations[i];
                              final selected = _activeConversation?.id == c.id;
                              return Card(
                                color: selected
                                    ? CredoColors.vaticanGoldSoft
                                    : CredoColors.warmSurface,
                                child: ListTile(
                                  leading: c.peer != null
                                      ? UserAvatar(user: c.peer!, radius: 20)
                                      : CircleAvatar(
                                          backgroundColor:
                                              parseHexColor(c.unitAccentColor)
                                                  .withValues(alpha: 0.16),
                                          child: Icon(
                                            Icons.groups_rounded,
                                            color: parseHexColor(
                                                c.unitAccentColor),
                                          ),
                                        ),
                                  title: Text(
                                    c.title,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(
                                        fontWeight: FontWeight.w700),
                                  ),
                                  subtitle: Text(
                                    c.lastMessageContent.isNotEmpty
                                        ? c.lastMessageContent
                                        : (c.isGroup
                                            ? '${c.membersCount} ${l10n.members}'
                                            : l10n.directMessage),
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                  onTap: () => _openConversation(c),
                                ),
                              );
                            },
                          ),
                    ListView.separated(
                      padding: const EdgeInsets.all(10),
                      itemCount: _discoverGroups.length,
                      separatorBuilder: (_, _) => const SizedBox(height: 8),
                      itemBuilder: (ctx, i) {
                        final g = _discoverGroups[i];
                        return Card(
                          child: ListTile(
                            leading: CircleAvatar(
                              backgroundColor: parseHexColor(g.unitAccentColor)
                                  .withValues(alpha: 0.16),
                              child: Icon(
                                unitTypeIcon(g.unitType ?? 'diocese'),
                                color: parseHexColor(g.unitAccentColor),
                              ),
                            ),
                            title: Text(
                              g.title,
                              style:
                                  const TextStyle(fontWeight: FontWeight.w700),
                            ),
                            subtitle: Text(
                              '${g.unitName ?? ''} · ${g.membersCount} ${l10n.members}',
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                            ),
                            trailing: g.isMember
                                ? TextButton(
                                    onPressed: () => _openConversation(g),
                                    child: Text(l10n.joined),
                                  )
                                : FilledButton.tonal(
                                    onPressed: () async {
                                      await widget.controller.api
                                          .joinGroup(g.id);
                                      await _loadConversations(selectId: g.id);
                                    },
                                    child: Text(l10n.joinGroup),
                                  ),
                          ),
                        );
                      },
                    ),
                  ],
                ),
        ),
      ],
    );
  }

  Widget _buildChatPane(
    BuildContext context,
    AppLocalizations l10n, {
    required bool showBack,
  }) {
    final conv = _activeConversation!;
    final myId = widget.controller.currentUser?.id;

    return Column(
      children: [
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          decoration: const BoxDecoration(
            color: CredoColors.warmSurface,
            border: Border(bottom: BorderSide(color: CredoColors.hairline)),
          ),
          child: Row(
            children: [
              if (showBack)
                IconButton(
                  onPressed: () => setState(() => _activeConversation = null),
                  icon: const Icon(Icons.arrow_back_rounded),
                ),
              if (conv.peer != null)
                GestureDetector(
                  onTap: () => widget.onOpenProfile(conv.peer!.id),
                  child: UserAvatar(user: conv.peer!, radius: 18),
                )
              else
                CircleAvatar(
                  radius: 18,
                  backgroundColor: parseHexColor(conv.unitAccentColor)
                      .withValues(alpha: 0.15),
                  child: Icon(Icons.groups_rounded,
                      size: 18, color: parseHexColor(conv.unitAccentColor)),
                ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      conv.title,
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    Text(
                      conv.isGroup
                          ? '${conv.unitName ?? l10n.pastoralGroup} · ${conv.membersCount} ${l10n.members}'
                          : (conv.peer?.currentOfficeTitle ??
                              l10n.directMessage),
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        Expanded(
          child: _loadingMessages
              ? const Center(child: CircularProgressIndicator())
              : ListView.builder(
                  controller: _scrollCtrl,
                  padding: const EdgeInsets.all(16),
                  itemCount: _messages.length,
                  itemBuilder: (ctx, i) {
                    final m = _messages[i];
                    final isMine = m.sender.id == myId;
                    return Align(
                      alignment:
                          isMine ? Alignment.centerRight : Alignment.centerLeft,
                      child: Container(
                        constraints: const BoxConstraints(maxWidth: 460),
                        margin: const EdgeInsets.only(bottom: 10),
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: isMine
                              ? CredoColors.cardinal
                              : CredoColors.warmSurface,
                          borderRadius: BorderRadius.circular(16),
                          border: isMine
                              ? null
                              : Border.all(color: CredoColors.hairline),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            if (!isMine) ...[
                              Wrap(
                                spacing: 6,
                                crossAxisAlignment: WrapCrossAlignment.center,
                                children: [
                                  InkWell(
                                    onTap: () =>
                                        widget.onOpenProfile(m.sender.id),
                                    child: Text(
                                      m.sender.displayName,
                                      style: const TextStyle(
                                        fontWeight: FontWeight.w700,
                                        fontSize: 12.5,
                                      ),
                                    ),
                                  ),
                                  RankBadge(
                                    rank: m.sender.ecclesiasticalRank,
                                    isVerified: m.sender.isVerified,
                                    compact: true,
                                  ),
                                ],
                              ),
                              const SizedBox(height: 5),
                            ],
                            Text(
                              m.content,
                              style: TextStyle(
                                color: isMine ? Colors.white : CredoColors.ink,
                                height: 1.4,
                              ),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              formatRelativeTime(m.createdAt),
                              style: TextStyle(
                                fontSize: 10.5,
                                color: isMine
                                    ? Colors.white.withValues(alpha: 0.72)
                                    : CredoColors.mutedInk,
                              ),
                            ),
                          ],
                        ),
                      ),
                    );
                  },
                ),
        ),
        Container(
          padding: const EdgeInsets.fromLTRB(14, 10, 14, 14),
          decoration: const BoxDecoration(
            color: CredoColors.warmSurface,
            border: Border(top: BorderSide(color: CredoColors.hairline)),
          ),
          child: Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _msgCtrl,
                  onSubmitted: (_) => _sendMessage(),
                  decoration: InputDecoration(hintText: l10n.typeMessage),
                ),
              ),
              const SizedBox(width: 10),
              FilledButton.icon(
                onPressed: _sending ? null : _sendMessage,
                icon: const Icon(Icons.send_rounded, size: 17),
                label: Text(l10n.send),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
