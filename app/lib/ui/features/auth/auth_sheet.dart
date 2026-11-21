import 'package:flutter/material.dart';
import '../../../domain/models/ecclesiastical_unit.dart';
import '../../../l10n/generated/app_localizations.dart';
import '../../../state/app_controller.dart';
import '../../core/labels.dart';
import '../../core/theme.dart';
import '../../core/widgets/unit_picker_dialog.dart';

Future<bool?> showAuthDialog({
  required BuildContext context,
  required AppController controller,
  bool initialRegister = false,
}) {
  return showDialog<bool>(
    context: context,
    builder: (ctx) => _AuthDialog(
      controller: controller,
      initialRegister: initialRegister,
    ),
  );
}

class _AuthDialog extends StatefulWidget {
  const _AuthDialog({
    required this.controller,
    required this.initialRegister,
  });

  final AppController controller;
  final bool initialRegister;

  @override
  State<_AuthDialog> createState() => _AuthDialogState();
}

class _AuthDialogState extends State<_AuthDialog> {
  late bool _isRegister;
  bool _loading = false;
  String? _error;

  final _emailCtrl = TextEditingController();
  final _usernameCtrl = TextEditingController();
  final _passwordCtrl = TextEditingController();
  final _fullNameCtrl = TextEditingController();
  final _officeCtrl = TextEditingController();
  final _mottoCtrl = TextEditingController();

  String _selectedRank = 'lay';
  EcclesiasticalUnit? _selectedUnit;
  EcclesiasticalUnit? _selectedOrder;

  @override
  void initState() {
    super.initState();
    _isRegister = widget.initialRegister;
  }

  @override
  void dispose() {
    _emailCtrl.dispose();
    _usernameCtrl.dispose();
    _passwordCtrl.dispose();
    _fullNameCtrl.dispose();
    _officeCtrl.dispose();
    _mottoCtrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      if (_isRegister) {
        await widget.controller.register(
          email: _emailCtrl.text.trim(),
          password: _passwordCtrl.text,
          fullName: _fullNameCtrl.text.trim(),
          username: _usernameCtrl.text.trim(),
          ecclesiasticalRank: _selectedRank,
          primaryUnitId: _selectedUnit?.id,
          religiousOrderId: _selectedOrder?.id,
          currentOfficeTitle: _officeCtrl.text.trim(),
          motto: _mottoCtrl.text.trim(),
          countryCode: _selectedUnit?.countryCode ?? 'VA',
        );
      } else {
        await widget.controller.login(
          _emailCtrl.text.trim(),
          _passwordCtrl.text,
        );
      }
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _quickDemo(String email) async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      await widget.controller.login(email, 'Credo2026!');
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final isClergy = isClergyRankCode(_selectedRank);

    return Dialog(
      backgroundColor: CredoColors.warmSurface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(22)),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 500, maxHeight: 720),
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
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
                          _isRegister ? l10n.register : l10n.signIn,
                          style: Theme.of(context).textTheme.headlineSmall,
                        ),
                        Text(
                          _isRegister ? l10n.joinCredo : l10n.welcomeBack,
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    onPressed: () => Navigator.of(context).pop(),
                    icon: const Icon(Icons.close_rounded),
                  ),
                ],
              ),
              const SizedBox(height: 18),
              if (_error != null) ...[
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: Colors.red.shade50,
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: Colors.red.shade200),
                  ),
                  child: Text(
                    _error!,
                    style: TextStyle(color: Colors.red.shade800, fontSize: 13),
                  ),
                ),
                const SizedBox(height: 14),
              ],
              if (_isRegister) ...[
                TextField(
                  controller: _fullNameCtrl,
                  decoration: InputDecoration(
                    labelText: l10n.fullName,
                    prefixIcon: const Icon(Icons.person_outline_rounded),
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _usernameCtrl,
                  decoration: InputDecoration(
                    labelText: l10n.username,
                    prefixIcon: const Icon(Icons.alternate_email_rounded),
                  ),
                ),
                const SizedBox(height: 12),
              ],
              TextField(
                controller: _emailCtrl,
                keyboardType: TextInputType.emailAddress,
                decoration: InputDecoration(
                  labelText: _isRegister ? l10n.email : l10n.emailOrUsername,
                  prefixIcon: const Icon(Icons.mail_outline_rounded),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _passwordCtrl,
                obscureText: true,
                onSubmitted: (_) => _isRegister ? null : _submit(),
                decoration: InputDecoration(
                  labelText: l10n.password,
                  prefixIcon: const Icon(Icons.lock_outline_rounded),
                ),
              ),
              if (_isRegister) ...[
                const SizedBox(height: 14),
                DropdownButtonFormField<String>(
                  initialValue: _selectedRank,
                  decoration: InputDecoration(
                    labelText: l10n.selectRank,
                    prefixIcon: const Icon(Icons.shield_outlined),
                  ),
                  items: kAllSelectableRanks.map((r) {
                    return DropdownMenuItem(
                      value: r,
                      child: Row(
                        children: [
                          Container(
                            width: 10,
                            height: 10,
                            decoration: BoxDecoration(
                              color: rankColor(r),
                              shape: BoxShape.circle,
                            ),
                          ),
                          const SizedBox(width: 8),
                          Text(rankLabel(l10n, r)),
                        ],
                      ),
                    );
                  }).toList(),
                  onChanged: (v) {
                    if (v != null) setState(() => _selectedRank = v);
                  },
                ),
                const SizedBox(height: 10),
                Container(
                  padding: const EdgeInsets.all(11),
                  decoration: BoxDecoration(
                    color: isClergy
                        ? CredoColors.vaticanGoldSoft
                        : CredoColors.warmTint,
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(
                      color: isClergy
                          ? CredoColors.vaticanGold.withValues(alpha: 0.45)
                          : CredoColors.hairline,
                    ),
                  ),
                  child: Row(
                    children: [
                      Icon(
                        isClergy
                            ? Icons.edit_note_rounded
                            : Icons.info_outline_rounded,
                        size: 18,
                        color: isClergy
                            ? CredoColors.vaticanGold
                            : CredoColors.mutedInk,
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          isClergy
                              ? l10n.clergyCanPublishHint
                              : l10n.layCannotPublishHint,
                          style: const TextStyle(fontSize: 12.5, height: 1.35),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 12),
                InkWell(
                  onTap: () async {
                    final picked = await showUnitPickerDialog(
                      context: context,
                      units: widget.controller.allUnits,
                      selectedUnitId: _selectedUnit?.id,
                      title: l10n.selectAffiliation,
                    );
                    if (picked != null) {
                      setState(() => _selectedUnit = picked);
                    }
                  },
                  borderRadius: BorderRadius.circular(12),
                  child: InputDecorator(
                    decoration: InputDecoration(
                      labelText: l10n.selectAffiliation,
                      prefixIcon: const Icon(Icons.church_outlined),
                      suffixIcon: const Icon(Icons.search_rounded),
                    ),
                    child: Text(
                      _selectedUnit != null
                          ? '${countryFlag(_selectedUnit!.countryCode)} ${_selectedUnit!.name}'
                          : '—',
                      style: TextStyle(
                        color: _selectedUnit != null
                            ? CredoColors.ink
                            : CredoColors.mutedInk,
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                InkWell(
                  onTap: () async {
                    final picked = await showUnitPickerDialog(
                      context: context,
                      units: widget.controller.allUnits,
                      filterType: 'religious_order',
                      selectedUnitId: _selectedOrder?.id,
                      title: l10n.optionalReligiousOrder,
                    );
                    if (picked != null) {
                      setState(() => _selectedOrder = picked);
                    }
                  },
                  borderRadius: BorderRadius.circular(12),
                  child: InputDecorator(
                    decoration: InputDecoration(
                      labelText: l10n.optionalReligiousOrder,
                      prefixIcon: const Icon(Icons.auto_stories_outlined),
                      suffixIcon: _selectedOrder != null
                          ? IconButton(
                              icon: const Icon(Icons.clear_rounded, size: 18),
                              onPressed: () =>
                                  setState(() => _selectedOrder = null),
                            )
                          : const Icon(Icons.search_rounded),
                    ),
                    child: Text(
                      _selectedOrder?.name ?? '—',
                      style: TextStyle(
                        color: _selectedOrder != null
                            ? CredoColors.ink
                            : CredoColors.mutedInk,
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _officeCtrl,
                  decoration: InputDecoration(
                    labelText: l10n.currentOfficeTitle,
                    prefixIcon: const Icon(Icons.work_outline_rounded),
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _mottoCtrl,
                  decoration: InputDecoration(
                    labelText: l10n.motto,
                    prefixIcon: const Icon(Icons.format_quote_rounded),
                  ),
                ),
              ],
              const SizedBox(height: 18),
              FilledButton(
                onPressed: _loading ? null : _submit,
                child: _loading
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : Text(_isRegister ? l10n.createAccount : l10n.signIn),
              ),
              const SizedBox(height: 10),
              TextButton(
                onPressed: () => setState(() {
                  _isRegister = !_isRegister;
                  _error = null;
                }),
                child: Text(
                  _isRegister ? l10n.alreadyHaveAccount : l10n.noAccountYet,
                ),
              ),
              if (!_isRegister) ...[
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 12),
                  child: Divider(),
                ),
                Text(
                  l10n.demoQuickAccess,
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                ),
                const SizedBox(height: 8),
                OutlinedButton.icon(
                  onPressed: _loading
                      ? null
                      : () => _quickDemo('padre.mateo@credo.org'),
                  icon: const Icon(Icons.verified_user_rounded, size: 18),
                  label: Text(l10n.demoClergyAccount),
                ),
                const SizedBox(height: 8),
                OutlinedButton.icon(
                  onPressed: _loading
                      ? null
                      : () => _quickDemo('maria.laica@credo.org'),
                  icon: const Icon(Icons.person_rounded, size: 18),
                  label: Text(l10n.demoLayAccount),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
