// Destination dans le repo hbr_frontend (remplace le fichier existant) :
// lib/features/sales/presentation/pages/new_sale_screen.dart
//
// Changements vs version actuelle (cherchez "ELEVAGE" dans ce fichier) :
// 1. Import de isElevageModule, LivestockProvider, showLivestockSaleSelectorModal.
// 2. _loadData() : si le module actif est Élevage, charge LivestockProvider
//    au lieu du catalogue Product.
// 3. _addItem() : si Élevage -> ouvre le sélecteur d'animaux du Cheptel ;
//    sinon comportement inchangé (catalogue Product).
// 4. Le bouton scan QR (codes articles du catalogue) est masqué en mode Élevage.
// 5. _createSale() : après succès, si Élevage, enregistre un mouvement
//    "sale" dans LivestockProvider pour chaque animal vendu, afin que le
//    Cheptel reste synchronisé avec la caisse.
// La synchronisation existante (LivestockProvider.syncCatalog, appelée dans
// livestock_tab.dart à l'ouverture de l'onglet Cheptel) N'EST PAS touchée et
// continue de tourner comme avant.

import 'package:auto_size_text/auto_size_text.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:go_router/go_router.dart';
import 'package:hbr/core/domain/entities/operation.dart';
import 'package:hbr/core/domain/entities/operation_product.dart';
import 'package:hbr/core/extensions/date_formart.dart';
import 'package:hbr/core/domain/entities/new_operation_product_item.dart';
import 'package:hbr/core/extensions/currency_format.dart';
import 'package:hbr/core/extensions/double_to_clean_string.dart';
import 'package:hbr/core/services/mock_service.dart';
import 'package:hbr/core/utils/elevage_module_utils.dart';
import 'package:hbr/core/utils/random_number.dart';
import 'package:hbr/core/widgets/client_selector_modal.dart';
import 'package:hbr/core/widgets/livestock_sale_selector_modal.dart';
import 'package:hbr/core/widgets/print_operations_selector_modal.dart';
import 'package:hbr/core/widgets/product_selector_modal.dart';
import 'package:hbr/core/widgets/qr_scanner.dart';
import 'package:hbr/features/installations/data/models/installation_complet.dart';
import 'package:hbr/features/livestock/presentation/providers/livestock_provider.dart';
import 'package:hbr/features/profile/presentation/providers/profile_provider.dart';
import 'package:provider/provider.dart';
import '../../../catalog/presentation/providers/product_provider.dart';
import '../../../clients/domain/entities/client.dart';
import '../../../clients/presentation/providers/client_provider.dart';
import '../../domain/entities/sale.dart';
import '../providers/sales_provider.dart';

class NewSaleScreen extends StatefulWidget {
  final InstallationCompletModel installation;
  const NewSaleScreen({super.key, required this.installation});

  @override
  State<NewSaleScreen> createState() => _NewSaleScreenState();
}

class _NewSaleScreenState extends State<NewSaleScreen> {
  final _formKey = GlobalKey<FormState>();

  final Map<int, NewOperationProductItem> _items = {};
  Client? _selectedClient;

  final _invoiceController = TextEditingController();
  final _rabaisController = TextEditingController();
  final _remiseController = TextEditingController();
  final _paidAmountController = TextEditingController();

  bool _applyTva = false;
  bool _isCredit = false;
  bool _isPressing = false;
  bool _isExpress = false;
  DateTime _saleDate = DateTime.now();
  late final String _code;

  // ELEVAGE: true quand le module actif de cette vente est un module Élevage.
  // Dans ce cas les articles viennent du Cheptel (LivestockProvider), pas du
  // catalogue Product.
  bool get _isElevage =>
      widget.installation.modules.isNotEmpty &&
      isElevageModule(widget.installation.modules.first);

  @override
  void dispose() {
    _invoiceController.dispose();
    _rabaisController.dispose();
    _remiseController.dispose();
    _paidAmountController.dispose();
    super.dispose();
  }

  double get _subTotal => _items.values.fold(
        0.0,
        (sum, item) => sum + (item.price * item.quantity),
      );

  double get _discount =>
      (double.tryParse(_rabaisController.text) ?? 0.0) +
      (double.tryParse(_remiseController.text) ?? 0.0);

  double get _tvaAmount {
    if (!_applyTva) return 0.0;
    final taxable = _subTotal - _discount;
    final rate = (widget.installation.installation.tva ?? 0.0) / 100.0;
    return taxable > 0 ? taxable * rate : 0.0;
  }

  double get _finalTotal => _subTotal - _discount + _tvaAmount;

  @override
  void initState() {
    super.initState();
    _code = MockServices.generateUniqueCode();
    _isPressing = widget.installation.hasActivePressingsModule(false);
    if (_isPressing) {
      _isCredit = true;
    }
    _loadData();
  }

  Future<void> _loadData() async {
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      final installationId = widget.installation.installation.id;
      final modules = widget.installation.modules.map((m) => m.id).toList();
      context.read<ClientProvider>().loadClients(installationId);
      context.read<ClientProvider>().getClients(installationId);
      // ELEVAGE: en module Élevage, on charge le Cheptel directement et on
      // ignore le catalogue Product (réservé aux intrants/autres articles).
      if (_isElevage) {
        await context
            .read<LivestockProvider>()
            .loadByModule(widget.installation.modules.first.id);
      } else {
        await context.read<ProductProvider>().getProducts(
          installationId,
          modulesInstallation: modules,
        );
      }
    });
  }

  void _updateExpressPrices() {
    if (!_isPressing) return;
    for (final entry in _items.entries) {
      final expressPrice = entry.value.prices.firstWhere(
        (price) =>
            price.$1.toLowerCase().contains('expres') == _isExpress,
        orElse: () => ('', entry.value.price),
      );
      _items[entry.key] = entry.value.copyWith(price: expressPrice.$2);
    }
  }

  void _addItem() async {
    // ELEVAGE: sélection d'animaux du Cheptel au lieu d'articles du catalogue.
    final items = _isElevage
        ? await showLivestockSaleSelectorModal(
            context,
            installation: widget.installation,
            selectedAnimals: _items,
          )
        : await showProductSelectorModal(
            context,
            installation: widget.installation,
            selectedProducts: _items,
            vente: true,
            isExpress: _isExpress,
          );
    if (items != null && mounted) {
      setState(() {
        _items.clear();
        _items.addAll(items);
      });
    }
  }

  void _selectClient() async {
    final client = await showClientSelectorModal(
      context: context,
      installation: widget.installation,
      selectedClient: _selectedClient,
    );

    if (client != null) {
      setState(() {
        _selectedClient = client;
      });
    }
  }

  void _createSale() async {
    _items.removeWhere((key, value) => value.quantity <= 0);
    setState(() {});
    if (_formKey.currentState!.validate() && _items.isNotEmpty) {
      if (_isCredit) {
        if (_paidAmountController.text.isEmpty) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text(
                'Le montant payé est requis pour une vente à crédit',
              ),
              backgroundColor: Colors.red,
            ),
          );
          return;
        } else if (_selectedClient == null) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Le client est requis pour une vente à crédit'),
              backgroundColor: Colors.red,
            ),
          );
          return;
        }
      }
      final sale = Sale(
        id: 0, // Auto-incremented by DB
        code: _code,
        clientId: _selectedClient?.id,
        clientName: _selectedClient?.name,
        date: _saleDate,
        total: _finalTotal,
        amount: _isCredit
            ? (double.tryParse(_paidAmountController.text) ?? 0.0)
            : _finalTotal,
        installationId: widget.installation.installation.id,
        moduleId: widget.installation.modules.first.module,
        installationModuleId: widget.installation.modules.first.id,
        moduleName: widget.installation.modules.first.moduleName,
        pressing: _isPressing,
        express: _isExpress,
        items: _items.values
            .map(
              (e) => SaleItem(
                id: 0,
                productId: e.productId,
                productName: e.productName,
                productInstallation: e.productInstallation,
                quantity: e.quantity,
                price: e.price,
                prices: [],
                stock: e.stock,
              ),
            )
            .toList(), // as List<SaleItem>,
        numeroFacture: _invoiceController.text.isNotEmpty
            ? _invoiceController.text
            : null,
        rabais: double.tryParse(_rabaisController.text),
        remise: double.tryParse(_remiseController.text),
        tva: _applyTva ? _tvaAmount : null,
      );
      final salesProvider = context.read<SalesProvider>();
      final success = await salesProvider.addSale(sale);

      if (success && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Vente enregistrée avec succès'),
            backgroundColor: Colors.green,
          ),
        );
        // ELEVAGE: on garde le Cheptel synchronisé avec la caisse — chaque
        // animal/lot vendu génère un mouvement "sale" côté Cheptel.
        // Le mécanisme de sync du catalogue (syncCatalog), appelé depuis
        // livestock_tab.dart, n'est pas modifié et continue de fonctionner
        // indépendamment de cette vente.
        if (_isElevage) {
          final livestockProvider = context.read<LivestockProvider>();
          final moduleId = widget.installation.modules.first.id;
          for (final item in _items.values) {
            await livestockProvider.recordMovement({
              'animalId': item.productId,
              'movementType': 'sale',
              'movementDate': _saleDate.toIso8601String(),
              'quantity': item.quantity.round(),
              'unitPrice': item.price,
              'totalAmount': item.price * item.quantity,
              'notes': 'Vente $_code',
            }, moduleId);
          }
        } else {
          context.read<ProductProvider>().getProducts(
            widget.installation.installation.id,
          );
        }
        final profileProvider = context.read<ProfileProvider>();
        await profileProvider.loadProfile();
        // Print Ticket
        final operation = Operation(
          id: 0,
          type: 0,
          typeName: "VENTE",
          clientId: _selectedClient?.id,
          clientName: _selectedClient?.name,
          vendeur: profileProvider.user?.id ?? 0,
          vendeurName: profileProvider.user?.name ?? '',
          createdBy: profileProvider.user?.id ?? 0,
          createdByName: profileProvider.user?.name ?? '',
          date: _saleDate,
          total: _finalTotal,
          amount: _isCredit
              ? (double.tryParse(_paidAmountController.text) ?? 0.0)
              : _finalTotal,
          installation: widget.installation.installation.id,
          module: widget.installation.modules.first.module,
          installationModule: widget.installation.modules.first.id,
          moduleName: widget.installation.modules.first.moduleName,
          pressing: _isPressing,
          express: _isExpress,
          products: _items.values
              .map(
                (e) => OperationProduct(
                  id: 0,
                  product: e.productId,
                  productName: e.productName,
                  quantity: e.quantity,
                  amount: e.price,
                  stock: e.stock,
                ),
              )
              .toList(), // as List<SaleItem>,
          numeroFacture: _invoiceController.text.isNotEmpty
              ? _invoiceController.text
              : null,
          rabais: double.tryParse(_rabaisController.text),
          remise: double.tryParse(_remiseController.text),
          tva: _applyTva ? _tvaAmount : null,
        );
        await showPrintOperationsSelectorModal(
          context,
          installation: widget.installation,
          operations: [operation],
          client: _selectedClient,
        );
        if (mounted) {
          context.pop();
        }
      } else if (!success && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Vente non enregistrée:${salesProvider.error}'),
            backgroundColor: Colors.red,
          ),
        );
      }
    } else if (_items.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Veuillez ajouter au moins un article')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    if (widget.installation.modules.isEmpty) {
      return Scaffold(
        appBar: AppBar(title: const Text('Vente')),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.error_outline, size: 48, color: Colors.orange),
                const SizedBox(height: 16),
                const Text(
                  'Aucun module sélectionné pour cette vente.',
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 16),
                FilledButton(
                  onPressed: () => Navigator.of(context).maybePop(),
                  child: const Text('Retour'),
                ),
              ],
            ),
          ),
        ),
      );
    }

    final activeModule = widget.installation.modules.first;

    return Scaffold(
      appBar: AppBar(
        title: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('Vente'),
            AutoSizeText(
              "${activeModule.name} | ${widget.installation.installation.name}",
              maxLines: 1,
              minFontSize: 9,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(color: Colors.white, fontSize: 12),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: _createSale,
            child: const Text(
              'Enregistrer',
              style: TextStyle(color: Colors.white),
            ),
          ),
        ],
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Form(
            key: _formKey,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Type Selector
                if (_isPressing) ...[
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: RadioListTile<bool>(
                          contentPadding: EdgeInsets.zero,
                          visualDensity: VisualDensity.compact,
                          title: const Text('Normal'),
                          value: false,
                          groupValue: _isExpress,
                          onChanged: (val) {
                            setState(() {
                              _isExpress = val ?? false;
                              _updateExpressPrices();
                            });
                          },
                        ),
                      ),
                      Expanded(
                        child: RadioListTile<bool>(
                          contentPadding: EdgeInsets.zero,
                          visualDensity: VisualDensity.compact,
                          title: const Text('Express'),
                          value: true,
                          groupValue: _isExpress,
                          onChanged: (val) {
                            setState(() {
                              _isExpress = val ?? false;
                              _updateExpressPrices();
                            });
                          },
                        ),
                      ),
                    ],
                  ),

                  const SizedBox(height: 20),
                ],
                // Client Selection
                InkWell(
                  onTap: _selectClient,
                  borderRadius: BorderRadius.circular(12),
                  child: Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      border: Border.all(color: Colors.grey[300]!),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Row(
                      children: [
                        const Icon(Icons.person, color: Color(0xFF2563EB)),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              AutoSizeText(
                                'Client ${_isCredit ? "(obligatoire)" : "(optionnel)"}',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  fontSize: 12,
                                  color: Colors.grey[600],
                                ),
                              ),
                              const SizedBox(height: 4),
                              AutoSizeText(
                                _selectedClient?.name ??
                                    'Sélectionner un client',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  fontSize: 16,
                                  fontWeight: _selectedClient != null
                                      ? FontWeight.bold
                                      : FontWeight.normal,
                                  color: _selectedClient != null
                                      ? Colors.black87
                                      : Colors.grey[400],
                                ),
                              ),
                            ],
                          ),
                        ),
                        Icon(
                          Icons.arrow_forward_ios,
                          size: 16,
                          color: Colors.grey[400],
                        ),
                      ],
                    ),
                  ),
                ).animate().fadeIn(delay: 200.ms),

                const SizedBox(height: 10),

                // Invoice and Date
                Row(
                  children: [
                    Expanded(
                      flex: 5,
                      child: TextFormField(
                        controller: _invoiceController,
                        decoration: InputDecoration(
                          labelText: 'N° Facture',
                          border: OutlineInputBorder(),
                          prefixIcon: Icon(Icons.receipt_long),
                          contentPadding: EdgeInsets.symmetric(
                            horizontal: 12,
                            vertical: 12,
                          ),
                          suffixIcon: IconButton(
                            icon: Icon(Icons.generating_tokens_outlined),
                            onPressed: () {
                              _invoiceController.text =
                                  InvoiceNumberGenerator.generateInvoiceNumber();
                            },
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      flex: 3,
                      child: InkWell(
                        onTap: () async {
                          final date = await showDatePicker(
                            context: context,
                            initialDate: _saleDate,
                            firstDate: DateTime.now().subtract(const Duration(days: 365)),
                            lastDate: DateTime(2100),
                          );
                          if (date != null) {
                            setState(() {
                              _saleDate = date;
                            });
                          }
                        },
                        child: InputDecorator(
                          decoration: const InputDecoration(
                            labelText: 'Date',
                            border: OutlineInputBorder(),
                            contentPadding: EdgeInsets.symmetric(
                              horizontal: 12,
                              vertical: 12,
                            ),
                          ),
                          child: AutoSizeText(
                            _saleDate.formatShort(),
                            maxLines: 1,
                          ),
                        ),
                      ),
                    ),
                  ],
                ).animate().fadeIn(delay: 250.ms),

                const SizedBox(height: 24),

                // Items Section
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        _isElevage ? 'Animaux' : 'Articles',
                        style: Theme.of(context).textTheme.titleMedium
                            ?.copyWith(fontWeight: FontWeight.bold),
                      ),
                    ),
                    // ELEVAGE: le scan QR cible le catalogue Product, donc on
                    // le masque en mode Élevage puisqu'on ne le consulte plus.
                    if (!_isElevage)
                      IconButton.filled(
                        icon: const Icon(Icons.qr_code),
                        onPressed: () {
                          showModalBottomSheet<String>(
                            context: context,
                            isScrollControlled: true,
                            builder: (context) {
                              return DraggableScrollableSheet(
                                expand: false,
                                maxChildSize: .75,
                                initialChildSize: .75,
                                builder: (context, scrollController) {
                                  return const HbrQRScanner();
                                },
                              );
                            },
                          ).then((value) async {
                            if (value != null && context.mounted) {
                              final product = await context
                                  .read<ProductProvider>()
                                  .getProductByCode(
                                    widget.installation.installation.id,
                                    widget.installation.modules.first.id,
                                    value,
                                  );
                              if (product != null) {
                                setState(() {
                                  _items.addAll({
                                    product.productId: NewOperationProductItem(
                                      id: product.productId,
                                      productId: product.productId,
                                      productName: product.product.name,
                                      productInstallation: product.id,
                                      stock: product.stock,
                                      quantity: 1,
                                      price: product.prices.first.amount,
                                      prices: product.prices
                                          .map(
                                            (price) => (price.type, price.amount),
                                          )
                                          .toList(),
                                    ),
                                  });
                                });
                              }
                            }
                          });
                        },
                      ),
                    ElevatedButton(
                      onPressed: _addItem,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFF2563EB),
                        foregroundColor: Colors.white,
                      ),
                      child: const Icon(Icons.add),
                    ),
                  ],
                ).animate().fadeIn(delay: 300.ms),

                const SizedBox(height: 12),

                // Items List
                if (_items.isEmpty)
                  Container(
                    padding: const EdgeInsets.all(32),
                    decoration: BoxDecoration(
                      color: Colors.grey[100],
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Center(
                      child: Text(
                        _isElevage
                            ? 'Aucun animal ajouté'
                            : 'Aucun article ajouté',
                        style: TextStyle(color: Colors.grey[600]),
                      ),
                    ),
                  ).animate().fadeIn(delay: 400.ms)
                else
                  ..._items.values.map((item) {
                    return Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: TextFormField(
                        initialValue: item.quantity.toCleanString(),
                        style: const TextStyle(
                          fontWeight: FontWeight.bold,
                          fontSize: 15,
                        ),
                        inputFormatters: [
                          FilteringTextInputFormatter.allow(
                            RegExp(r'^[0-9.]+'),
                          ),
                        ],
                        keyboardType: TextInputType.numberWithOptions(
                          decimal: true,
                        ),
                        onChanged: (value) {
                          if (value.isEmpty) {
                            ScaffoldMessenger.of(
                              context,
                            ).hideCurrentSnackBar();
                            setState(() {
                              _items[item.productId] = item.copyWith(
                                quantity: 0,
                              );
                            });
                            return;
                          }
                          double quantity = double.parse(value);
                          if (!_isPressing &&
                              quantity > item.stock &&
                              !widget
                                  .installation
                                  .installation
                                  .canSellNegative) {
                            ScaffoldMessenger.of(
                              context,
                            ).hideCurrentSnackBar();
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(
                                duration: Duration(seconds: 3),
                                content: Text(
                                  'La quantité ne peut pas être supérieure au stock disponible.',
                                ),
                              ),
                            );
                            setState(() {
                              _items[item.productId] = item.copyWith(
                                quantity: item.quantity,
                                id: DateTime.now().millisecond,
                              );
                            });
                            return;
                          }
                          setState(() {
                            _items[item.productId] = item.copyWith(
                              quantity: quantity,
                            );
                          });
                        },
                        decoration: InputDecoration(
                          hintText: _isElevage
                              ? 'Quantité à vendre'
                              : 'Quantité à vendre',
                          labelText: item.productName,
                          labelStyle: const TextStyle(
                            fontWeight: FontWeight.bold,
                          ),
                          helperMaxLines: 3,
                          helperText: !_isPressing
                              ? 'En stock: ${item.stock.formatCurrency()} | Total: ${(item.price * item.quantity).formatCurrency()}'
                              : null,
                          border: const OutlineInputBorder(
                            gapPadding: 2,
                            borderRadius: BorderRadius.all(
                              Radius.circular(4),
                            ),
                          ),
                          focusedBorder: const OutlineInputBorder(
                            gapPadding: 2,
                            borderRadius: BorderRadius.all(
                              Radius.circular(4),
                            ),
                          ),
                          suffixIcon: Container(
                            decoration: BoxDecoration(
                              border: Border(left: BorderSide()),
                            ),
                            child: PopupMenuButton(
                              icon: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Flexible(
                                    child: Text(
                                      item.price.formatCurrency(),
                                    ),
                                  ),
                                  Icon(Icons.arrow_drop_down, size: 16),
                                ],
                              ),
                              itemBuilder: (context) => item.prices
                                  .map(
                                    (price) => PopupMenuItem(
                                      value: price.$2,
                                      child: Text(
                                        "${price.$2.formatCurrency()} (${price.$1})",
                                      ),
                                    ),
                                  )
                                  .toList(),
                              onSelected: (value) {
                                setState(() {
                                  _items[item.productId] = item.copyWith(
                                    price: value,
                                  );
                                });
                              },
                            ),
                          ),
                        ),
                      ),
                    )
                        .animate(delay: Duration(milliseconds: 400 + (100)))
                        .fadeIn()
                        .slideX(begin: -0.1);
                  }),

                const SizedBox(height: 24),

                // Financial Fields
                Column(
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: TextFormField(
                            controller: _rabaisController,
                            keyboardType: const TextInputType.numberWithOptions(
                              decimal: true,
                            ),
                            decoration: const InputDecoration(
                              labelText: 'Rabais',
                              border: OutlineInputBorder(),
                              helperText: 'En montant fixe',
                            ),
                            onChanged: (_) => setState(() {}),
                            inputFormatters: [
                              FilteringTextInputFormatter.allow(
                                RegExp(r'^\d+\.?\d{0,2}'),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: TextFormField(
                            controller: _remiseController,
                            keyboardType: const TextInputType.numberWithOptions(
                              decimal: true,
                            ),
                            decoration: const InputDecoration(
                              labelText: 'Remise',
                              border: OutlineInputBorder(),
                              helperText: 'En montant fixe',
                            ),
                            onChanged: (_) => setState(() {}),
                            inputFormatters: [
                              FilteringTextInputFormatter.allow(
                                RegExp(r'^\d+\.?\d{0,2}'),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    SwitchListTile(
                      title: const Text('Appliquer TVA'),
                      subtitle: Text(
                        'Taux: ${(widget.installation.installation.tva ?? 0).formatCurrency()}%',
                      ),
                      value: _applyTva,
                      onChanged: (value) => setState(() => _applyTva = value),
                      contentPadding: EdgeInsets.zero,
                    ),
                    SwitchListTile(
                      title: const Text('Vente à crédit'),
                      value: _isCredit,
                      onChanged: (value) => setState(() => _isCredit = value),
                      contentPadding: EdgeInsets.zero,
                    ),
                    if (_isCredit)
                      Padding(
                        padding: const EdgeInsets.only(top: 8.0),
                        child: TextFormField(
                          controller: _paidAmountController,
                          keyboardType: const TextInputType.numberWithOptions(
                            decimal: true,
                          ),
                          decoration: const InputDecoration(
                            labelText: 'Montant payé',
                            border: OutlineInputBorder(),
                            suffixText: 'FCFA',
                            prefixIcon: Icon(Icons.payment),
                          ),
                          onChanged: (_) => setState(() {}),
                          validator: (value) {
                            if (value == null || value.isEmpty) {
                              return 'Requis pour vente à crédit';
                            }
                            final paid = double.tryParse(value) ?? 0;
                            if (paid > _finalTotal) {
                              return 'Le montant ne peut pas dépasser le total';
                            }
                            return null;
                          },
                        ),
                      ).animate().fadeIn(),
                  ],
                ).animate().fadeIn(delay: 500.ms),

                const SizedBox(height: 24),

                // Total
                Container(
                  padding: const EdgeInsets.all(20),
                  decoration: BoxDecoration(
                    gradient: const LinearGradient(
                      colors: [Color(0xFF2563EB), Color(0xFF1D4ED8)],
                    ),
                    borderRadius: BorderRadius.circular(12),
                    boxShadow: [
                      BoxShadow(
                        color: const Color(0xFF2563EB).withValues(alpha: 0.3),
                        blurRadius: 8,
                        offset: const Offset(0, 4),
                      ),
                    ],
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text(
                        'Total',
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 18,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      Text(
                        _finalTotal.formatCurrency(),
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 24,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ],
                  ),
                ).animate().fadeIn(delay: 600.ms).scale(),

                const SizedBox(height: 32),

                // Create Button
                SizedBox(
                  width: double.infinity,
                  child: Consumer<SalesProvider>(
                    builder: (context, provider, child) {
                      return ElevatedButton.icon(
                        onPressed: provider.isLoading ? null : _createSale,
                        icon: const Icon(Icons.check_circle_outline),
                        label: provider.isLoading
                            ? const CircularProgressIndicator(
                                color: Colors.white,
                              )
                            : const Text(
                                'Enregistrer',
                                style: TextStyle(fontSize: 16),
                              ),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: Colors.green,
                          foregroundColor: Colors.white,
                          padding: const EdgeInsets.symmetric(vertical: 16),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(12),
                          ),
                        ),
                      );
                    },
                  ),
                ).animate().fadeIn(delay: 700.ms).scale(),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
