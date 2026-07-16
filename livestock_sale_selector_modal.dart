// Destination dans le repo hbr_frontend :
// lib/core/widgets/livestock_sale_selector_modal.dart
//
// Sélecteur d'animaux du Cheptel pour la vente — lit directement
// LivestockProvider (pas le catalogue Product synchronisé).

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:auto_size_text/auto_size_text.dart';
import 'package:hbr/core/domain/entities/new_operation_product_item.dart';
import 'package:hbr/core/extensions/currency_format.dart';
import 'package:hbr/core/extensions/double_to_clean_string.dart';
import 'package:hbr/features/installations/data/models/installation_complet.dart';
import 'package:hbr/features/livestock/data/models/livestock_model.dart';
import 'package:hbr/features/livestock/presentation/providers/livestock_provider.dart';
import 'package:provider/provider.dart';

/// Affiche un modal pour choisir des animaux du Cheptel à vendre,
/// au lieu de piocher dans le catalogue Product (réservé aux intrants/autres).
Future<Map<int, NewOperationProductItem>?> showLivestockSaleSelectorModal(
  BuildContext context, {
  required InstallationCompletModel installation,
  required Map<int, NewOperationProductItem> selectedAnimals,
}) async {
  return await showModalBottomSheet<Map<int, NewOperationProductItem>>(
    context: context,
    isScrollControlled: true,
    isDismissible: false,
    backgroundColor: Colors.transparent,
    builder: (context) => DraggableScrollableSheet(
      expand: false,
      maxChildSize: 0.88,
      initialChildSize: 0.88,
      builder: (context, scrollController) => LivestockSaleSelectorModal(
        installation: installation,
        selectedAnimals: selectedAnimals,
      ),
    ),
  );
}

class LivestockSaleSelectorModal extends StatefulWidget {
  final InstallationCompletModel installation;
  final Map<int, NewOperationProductItem> selectedAnimals;

  const LivestockSaleSelectorModal({
    super.key,
    required this.installation,
    required this.selectedAnimals,
  });

  @override
  State<LivestockSaleSelectorModal> createState() =>
      _LivestockSaleSelectorModalState();
}

class _LivestockSaleSelectorModalState
    extends State<LivestockSaleSelectorModal> {
  final TextEditingController _searchController = TextEditingController();
  String _searchQuery = '';
  final Map<int, NewOperationProductItem> _selectedAnimals = {};

  @override
  void initState() {
    super.initState();
    _selectedAnimals.addAll(widget.selectedAnimals);
    _loadAnimals();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  void _loadAnimals() {
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      final moduleId = widget.installation.modules.first.id;
      await context.read<LivestockProvider>().loadByModule(moduleId);
    });
  }

  List<LivestockAnimalModel> _filterAnimals(List<LivestockAnimalModel> all) {
    return all.where((animal) {
      if (animal.status != 'active') return false;
      if (_searchQuery.isEmpty) return true;
      final q = _searchQuery.toLowerCase();
      return animal.identifier.toLowerCase().contains(q) ||
          animal.species.toLowerCase().contains(q);
    }).toList();
  }

  void _showPriceQuantityDialog(LivestockAnimalModel animal) {
    final existing = _selectedAnimals[animal.id];
    final quantityController = TextEditingController(
      text: (existing?.quantity ?? 1).toCleanString(),
    );
    final priceController = TextEditingController(
      text: (existing?.price ?? animal.purchasePrice ?? 0).toString(),
    );

    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(
          animal.identifier.isNotEmpty ? animal.identifier : animal.species,
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: quantityController,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              inputFormatters: [
                FilteringTextInputFormatter.allow(RegExp(r'^[0-9.]+')),
              ],
              decoration: InputDecoration(
                labelText: 'Quantité à vendre',
                helperText: animal.isLot
                    ? 'Disponible: ${animal.quantity}'
                    : null,
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: priceController,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              inputFormatters: [
                FilteringTextInputFormatter.allow(RegExp(r'^[0-9.]+')),
              ],
              decoration: const InputDecoration(
                labelText: 'Prix de vente (unitaire)',
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Annuler'),
          ),
          FilledButton(
            onPressed: () {
              final quantity = double.tryParse(quantityController.text) ?? 0;
              final price = double.tryParse(priceController.text) ?? 0;
              if (quantity <= 0) {
                Navigator.pop(context);
                return;
              }
              if (animal.isLot && quantity > animal.quantity) {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(
                    content: Text(
                      'La quantité ne peut pas dépasser le nombre disponible.',
                    ),
                  ),
                );
                return;
              }
              setState(() {
                _selectedAnimals[animal.id] = NewOperationProductItem(
                  id: animal.id,
                  productId: animal.id,
                  productInstallation: null,
                  productName: animal.identifier.isNotEmpty
                      ? '${animal.identifier} (${animal.species})'
                      : animal.species,
                  quantity: quantity,
                  stock: animal.isLot ? animal.quantity : 1,
                  price: price,
                  prices: [('Vente', price)],
                );
              });
              Navigator.pop(context);
            },
            child: const Text('Valider'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final livestockProvider = context.watch<LivestockProvider>();
    final animals = _filterAnimals(livestockProvider.animals);

    return Scaffold(
      primary: false,
      backgroundColor: Colors.transparent,
      body: SafeArea(
        child: Container(
          decoration: const BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
          ),
          child: Column(
            children: [
              Container(
                margin: const EdgeInsets.only(top: 12),
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: Colors.grey[300],
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [const Color(0xFF2563EB), const Color(0xFF1E40AF)],
                  ),
                  borderRadius: const BorderRadius.vertical(
                    top: Radius.circular(20),
                  ),
                ),
                child: SafeArea(
                  bottom: false,
                  top: false,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          const Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                AutoSizeText(
                                  'Sélectionner un animal',
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: TextStyle(
                                    fontSize: 18,
                                    fontWeight: FontWeight.bold,
                                    color: Colors.white,
                                  ),
                                ),
                                SizedBox(height: 4),
                                AutoSizeText(
                                  'Choisissez un animal du cheptel à vendre',
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: TextStyle(
                                    fontSize: 13,
                                    color: Colors.white70,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          IconButton(
                            icon: const Icon(Icons.close, color: Colors.white),
                            onPressed: () =>
                                Navigator.of(context).pop(_selectedAnimals),
                          ),
                        ],
                      ),
                      const SizedBox(height: 14),
                      Container(
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: TextField(
                          controller: _searchController,
                          onChanged: (value) =>
                              setState(() => _searchQuery = value),
                          decoration: InputDecoration(
                            hintText: 'Rechercher un animal...',
                            prefixIcon: const Icon(Icons.search),
                            suffixIcon: _searchQuery.isNotEmpty
                                ? IconButton(
                                    icon: const Icon(Icons.clear),
                                    onPressed: () {
                                      _searchController.clear();
                                      setState(() => _searchQuery = '');
                                    },
                                  )
                                : null,
                            border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(12),
                              borderSide: BorderSide.none,
                            ),
                            filled: true,
                            fillColor: Colors.white,
                            contentPadding: const EdgeInsets.symmetric(
                              horizontal: 16,
                              vertical: 12,
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              Expanded(
                child: livestockProvider.loading
                    ? const Center(child: CircularProgressIndicator())
                    : animals.isEmpty
                        ? Center(
                            child: Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                Icon(
                                  Icons.pets_outlined,
                                  size: 64,
                                  color: Colors.grey[400],
                                ),
                                const SizedBox(height: 16),
                                Text(
                                  'Aucun animal disponible dans le cheptel',
                                  style: TextStyle(
                                    fontSize: 16,
                                    color: Colors.grey[600],
                                  ),
                                ),
                              ],
                            ),
                          )
                        : ListView.builder(
                            padding: const EdgeInsets.all(16),
                            itemCount: animals.length,
                            itemBuilder: (context, index) {
                              final animal = animals[index];
                              final isSelected = _selectedAnimals.containsKey(
                                animal.id,
                              );
                              final selectedItem = _selectedAnimals[animal.id];

                              return Container(
                                margin: const EdgeInsets.only(bottom: 12),
                                decoration: BoxDecoration(
                                  color: isSelected
                                      ? const Color(
                                          0xFF2563EB,
                                        ).withValues(alpha: 0.1)
                                      : Colors.grey[100],
                                  borderRadius: BorderRadius.circular(12),
                                  border: Border.all(
                                    color: isSelected
                                        ? const Color(0xFF2563EB)
                                        : Colors.transparent,
                                    width: 2,
                                  ),
                                ),
                                child: ListTile(
                                  title: AutoSizeText(
                                    animal.identifier.isNotEmpty
                                        ? animal.identifier
                                        : animal.species,
                                    maxLines: 1,
                                    style: TextStyle(
                                      fontWeight: FontWeight.w600,
                                      color: isSelected
                                          ? const Color(0xFF2563EB)
                                          : Colors.black87,
                                    ),
                                  ),
                                  subtitle: Text(
                                    animal.isLot
                                        ? '${animal.species} | Lot de ${animal.quantity}'
                                        : animal.species,
                                  ),
                                  trailing: isSelected
                                      ? Text(
                                          'Qté: ${selectedItem!.quantity.toCleanString()} • ${selectedItem.price.formatCurrency()}',
                                          style: const TextStyle(
                                            fontWeight: FontWeight.bold,
                                          ),
                                        )
                                      : const Icon(
                                          Icons.add_circle_outline,
                                          color: Color(0xFF2563EB),
                                        ),
                                  onTap: () =>
                                      _showPriceQuantityDialog(animal),
                                ),
                              );
                            },
                          ),
              ),
              Padding(
                padding: const EdgeInsets.only(
                  top: 16.0,
                  bottom: 10,
                  left: 16,
                  right: 16,
                ),
                child: ElevatedButton(
                  onPressed: () =>
                      Navigator.pop(context, _selectedAnimals),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: Colors.blue,
                    foregroundColor: Colors.white,
                  ),
                  child: const Center(child: Text('Valider')),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
