# Fix : stock impacté à la livraison, pas à la création (commandes)

Repo : `developerandre/hbr_backend`
Fichier : `src/apis/operation/operation.service.ts`

## Constat

Actuellement, dans `createOperation()`, le stock est décrémenté immédiatement à la création pour **toute** commande non-proforma :

```ts
if (
  !isProformaCommande &&
  (typeOperation.isVente ||
    typeOperation.isSortie ||
    typeOperation.isCommande)
) {
  p.stock = prodInstall.stock - p.quantity;
  await prodInstallRepo.update(prodInstall.id, {
    stock: () => `stock - ${p.quantity}`,
  });
  ...
}
```

Donc "En attente", "Livraison partielle", "Déjà payé" déduisent le stock dès la création — avant toute livraison. Seul "Proforma" diffère la déduction (via `confirmProforma`). C'est ce qui contredit "les commandes non livrées ne doivent pas impacter le stock".

## Changement 1 — `createOperation()` : ne plus décrémenter pour les commandes

Remplacer la condition pour exclure `isCommande` (seules Vente et Sortie restent immédiates) :

```ts
// AVANT
if (
  !isProformaCommande &&
  (typeOperation.isVente ||
    typeOperation.isSortie ||
    typeOperation.isCommande)
) {

// APRÈS
if (typeOperation.isVente || typeOperation.isSortie) {
```

(`isProformaCommande` n'est plus utile dans ce bloc — vous pouvez le laisser ou le retirer s'il n'est plus référencé ailleurs.)

Résultat : à la création, **aucune** commande (proforma ou pas) ne touche le stock. `p.stock` reste simplement non renseigné pour ces lignes, comme c'était déjà le cas pour les proforma.

## Changement 2 — `confirmProforma()` : ne plus décrémenter, juste activer la commande

```ts
// AVANT
async confirmProforma(userId: number, id: number): Promise<void> {
  ...
  for (const p of products) {
    const prodInstall = await prodInstallRepo... .getOne();
    ...
    const newStock = prodInstall.stock - p.quantity;
    await prodInstallRepo.update(prodInstall.id, { stock: () => `stock - ${p.quantity}` });
    await opProdRepo.update(p.id, { stock: newStock });
  }
  await operationRepo.update(id, { proforma: false });
}

// APRÈS
async confirmProforma(userId: number, id: number): Promise<void> {
  // Confirmer une proforma ne fait plus que l'activer : elle redevient une
  // commande normale (En attente / Livraison partielle / Déjà payé selon
  // amount/total) et le stock ne sera déduit qu'à la livraison, comme
  // n'importe quelle autre commande.
  await operationRepo.update(id, { proforma: false });
}
```

(Vous pouvez supprimer la boucle de chargement des produits/`prodInstallRepo` si elle ne sert plus qu'à ça.)

## Changement 3 — `updatedDateOperation()` : déduire le stock au passage en "livrée"

Ajouter les relations `type`, `products`, `products.product` au `findOne`, puis avant le `operationRepo.update(id, map)` final, insérer la déduction (idempotente : seulement si pas déjà livrée) :

```ts
async updatedDateOperation(
  userId: number,
  id: number,
  field: string,
  date: string,
): Promise<void> {
  await this.dataSource.transaction(async (manager) => {
    const operationRepo = manager.getRepository(Operation);
    const prodInstallRepo = manager.getRepository(ProductInstallation);

    const operation = await operationRepo.findOne({
      where: { id: Equal(id) },
      relations: [
        'created_by',
        'client',
        'chambre',
        'module',
        'installation',
        'installationModule',
        'type',
        'products',
        'products.product',
      ],
    });
    if (!operation) throw new NotFoundException('Opération introuvable');

    const map: Partial<Operation> = {};
    if (field === 'paye') {
      // ... inchangé
    } else if (field === 'traite') {
      map['traite'] = new Date(date);
    } else if (field === 'livree') {
      map['livree'] = new Date(date);
    } else if (field === 'livraison_partielle') {
      map['livraisonPartielle'] = new Date(date);
    } else {
      throw new BadRequestException('Champ invalide');
    }

    // --- NOUVEAU : déduction du stock à la livraison d'une commande ---
    if (field === 'livree' && operation.type?.isCommande && !operation.livree) {
      for (const p of operation.products ?? []) {
        const prodInstall = await prodInstallRepo.findOne({
          where: { id: Equal(p.productInstallationId) },
        });
        if (!prodInstall) continue;
        const newStock = prodInstall.stock - p.quantity;
        await prodInstallRepo.update(prodInstall.id, {
          stock: () => `stock - ${p.quantity}`,
        });
        await manager.getRepository(OperationProduct).update(p.id, {
          stock: newStock,
        });
      }
    }
    // --- FIN NOUVEAU ---

    if (map['amount']) {
      // ... inchangé
    }
    await operationRepo.update(id, map);
  });
}
```

Adaptez les noms exacts (`productInstallationId`, repo `OperationProduct`, imports) à ceux réellement utilisés ailleurs dans le fichier (ils sont déjà importés pour `createOperation`/`confirmProforma`).

Note : cette version ne déclenche pas le hook `livestockService.applySaleFromCashRageister` ni les alertes de stock bas à la livraison — `confirmProforma()` ne le faisait pas non plus avant ce fix. Si vous voulez ce comportement aussi à la livraison, dites-le et je l'ajoute.

## Changement 4 — `deleteOperation()` : ne restituer le stock d'une commande que si elle avait été livrée

```ts
// AVANT (schématique)
if (isAchat) {
  qb.set({ stock: () => `stock - ${product.quantity}` });
} else if (isVenteSortieCommande) {
  qb.set({ stock: () => `stock + ${product.quantity}` });
}

// APRÈS
if (isAchat) {
  qb.set({ stock: () => `stock - ${product.quantity}` });
} else if (operation.type.isVente || operation.type.isSortie) {
  qb.set({ stock: () => `stock + ${product.quantity}` });
} else if (operation.type.isCommande && operation.livree) {
  // le stock n'a été déduit qu'à la livraison : on ne le restitue que si elle a eu lieu
  qb.set({ stock: () => `stock + ${product.quantity}` });
}
```

## Résumé du nouveau comportement

| Statut commande | Stock impacté ? |
|---|---|
| Proforma | Non |
| En attente | Non |
| Livraison partielle (acompte) | Non |
| Déjà payé (mais non livrée) | Non |
| **Livrée** | **Oui, à ce moment précis** |

Le paiement partiel n'est pas concerné par ce fix : il est déjà géré (acompte à la création via `OrderCreateMode.livraisonPartielle`, et solde réglable ensuite via le bouton "Payer" / `updatePayment`). Aucune action requise sur ce point.
