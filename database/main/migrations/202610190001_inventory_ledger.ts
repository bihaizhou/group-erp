import { defineMigration } from '@nocobase/db';

export default defineMigration({
  name: '202610190001_inventory_ledger',
  async up({ builder, query, connection }) {
    await builder.addConstraint('warehouses', {
      type: 'unique',
      name: 'warehouse_stock_company_identity',
      fields: ['id', 'subjectId'],
    });
    for (const table of ['purchaseOrders', 'salesOrders', 'stockCounts']) {
      await builder.createCollection(table, (c) => {
        c.string('id', { length: 36, nullable: false });
        c.primary('id');
        c.string('code', { length: 64, nullable: false });
        c.unique('code');
        for (const field of ['subjectId', 'warehouseId'])
          c.string(field, { length: 36, nullable: false });
        c.string('status', { length: 32, nullable: false });
        c.integer('revision', { nullable: false, defaultValue: 1 });
        c.integer('lifecycleVersion', { nullable: false, defaultValue: 0 });
        c.integer('contentVersion', { nullable: false, defaultValue: 1 });
        c.integer('reviewRound', { nullable: false, defaultValue: 0 });
        for (const field of [
          'submittedVersionId',
          'approvedVersionId',
          'supersedesId',
        ])
          c.string(field, { length: 36, nullable: true });
        c.string('submittedBy', { length: 200, nullable: true });
        c.datetimeTz('submittedAt', { nullable: true });
        c.datetimeTz('approvedAt', { nullable: true });
        c.datetimeTz('statusChangedAt', { nullable: false });
        c.date('occurredOn', { nullable: false });
        c.text('reason', { nullable: false });
        c.text('notes', { nullable: false });
        c.string('nonce', { length: 36, nullable: false });
        for (const field of ['createdBy', 'updatedBy'])
          c.string(field, { length: 200, nullable: false });
        for (const field of ['createdAt', 'updatedAt'])
          c.datetimeTz(field, { nullable: false });
        if (table === 'stockCounts') {
          c.datetimeTz('baselineAt', { nullable: true });
          c.json('countedActors', { nullable: true });
        } else {
          c.string('partnerId', { length: 36, nullable: false });
          c.string('currency', { length: 3, nullable: false });
          c.date('deliveryOn', { nullable: true });
          c.text('deliveryTerms', { nullable: false });
          c.json('partnerSnapshot', { nullable: false });
          c.foreignKey('partnerId', {
            references: { collection: 'businessPartners', fields: ['id'] },
            name: `${table}_partner_fk`,
          });
        }
        c.unique(['id', 'subjectId']);
        c.unique(['id', 'warehouseId', 'subjectId']);
        c.index(['subjectId', 'status', 'updatedAt']);
        c.foreignKey(['warehouseId', 'subjectId'], {
          references: { collection: 'warehouses', fields: ['id', 'subjectId'] },
          name: `${table}_warehouse_company_fk`,
        });
        c.foreignKey('supersedesId', {
          references: { collection: table, fields: ['id'] },
          name: `${table}_supersedes_fk`,
        });
      });
    }
    for (const [table, parent] of [
      ['purchaseOrderLines', 'purchaseOrders'],
      ['salesOrderLines', 'salesOrders'],
    ]) {
      await builder.createCollection(table, (c) => {
        c.string('id', { length: 36, nullable: false });
        c.primary('id');
        for (const field of [
          'orderId',
          'subjectId',
          'skuId',
          'unitId',
          'baseUnitId',
        ])
          c.string(field, { length: 36, nullable: false });
        c.string('unitRuleId', { length: 36, nullable: true });
        c.integer('lineNo', { nullable: false });
        c.integer('revision', { nullable: false });
        c.string('status', { length: 32, nullable: false });
        c.string('nonce', { length: 36, nullable: false });
        for (const field of [
          'quantity',
          'baseQuantity',
          'numeratorSnapshot',
          'denominatorSnapshot',
        ])
          c.string(field, { length: 25, nullable: false });
        for (const field of [
          'fulfilledQuantity',
          'returnedQuantity',
          'replacementQuantity',
          'closedQuantity',
        ])
          c.string(field, { length: 25, nullable: false, defaultValue: '0' });
        c.string('unitPrice', { length: 30, nullable: true });
        c.string('managementModeSnapshot', { length: 32, nullable: false });
        c.json('selectionInput', { nullable: false });
        c.json('materialSnapshot', { nullable: false });
        c.text('notes', { nullable: false });
        c.unique(['id', 'orderId', 'subjectId']);
        c.unique(['orderId', 'lineNo']);
        c.foreignKey(['orderId', 'subjectId'], {
          references: { collection: parent, fields: ['id', 'subjectId'] },
          name: `${table}_parent_company_fk`,
        });
        for (const [field, target] of [
          ['skuId', 'materialSkus'],
          ['unitId', 'measureUnits'],
          ['baseUnitId', 'measureUnits'],
          ['unitRuleId', 'materialUnitRules'],
        ])
          c.foreignKey(field, {
            references: { collection: target, fields: ['id'] },
            name: `${table}_${field}_fk`,
          });
      });
    }
    await builder.createCollection('stockTransfers', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      c.string('code', { length: 64, nullable: false });
      c.unique('code');
      for (const field of [
        'subjectId',
        'warehouseId',
        'destinationWarehouseId',
      ])
        c.string(field, { length: 36, nullable: false });
      c.string('status', { length: 32, nullable: false });
      c.integer('revision', { nullable: false, defaultValue: 1 });
      c.integer('lifecycleVersion', { nullable: false, defaultValue: 0 });
      c.datetimeTz('statusChangedAt', { nullable: false });
      c.date('occurredOn', { nullable: false });
      c.text('reason', { nullable: false });
      c.text('notes', { nullable: false });
      c.string('nonce', { length: 36, nullable: false });
      c.integer('contentVersion', { nullable: false, defaultValue: 1 });
      c.integer('reviewRound', { nullable: false, defaultValue: 0 });
      for (const field of [
        'submittedVersionId',
        'approvedVersionId',
        'supersedesId',
      ])
        c.string(field, { length: 36, nullable: true });
      c.string('submittedBy', { length: 200, nullable: true });
      c.datetimeTz('submittedAt', { nullable: true });
      c.datetimeTz('approvedAt', { nullable: true });
      for (const field of ['createdBy', 'updatedBy'])
        c.string(field, { length: 200, nullable: false });
      for (const field of ['createdAt', 'updatedAt'])
        c.datetimeTz(field, { nullable: false });
      c.unique(['id', 'subjectId']);
      c.index(['subjectId', 'warehouseId', 'status']);
      for (const field of ['warehouseId', 'destinationWarehouseId'])
        c.foreignKey([field, 'subjectId'], {
          references: { collection: 'warehouses', fields: ['id', 'subjectId'] },
          name: `stock_transfer_${field}_company_fk`,
        });
    });
    await builder.createCollection('stockTransferLines', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      for (const field of [
        'transferId',
        'subjectId',
        'skuId',
        'baseUnitId',
        'unitId',
      ])
        c.string(field, { length: 36, nullable: false });
      c.string('unitRuleId', { length: 36, nullable: true });
      c.integer('lineNo', { nullable: false });
      c.integer('revision', { nullable: false });
      c.string('status', { length: 32, nullable: false });
      c.string('nonce', { length: 36, nullable: false });
      for (const field of [
        'quantity',
        'baseQuantity',
        'numeratorSnapshot',
        'denominatorSnapshot',
        'dispatchedQuantity',
        'receivedQuantity',
        'discrepancyQuantity',
      ])
        c.string(field, { length: 25, nullable: false });
      c.string('quality', { length: 32, nullable: false });
      c.json('selectionInput', { nullable: false });
      c.json('materialSnapshot', { nullable: false });
      c.text('notes', { nullable: false });
      c.unique(['id', 'transferId', 'subjectId']);
      c.unique(['transferId', 'lineNo']);
      c.foreignKey(['transferId', 'subjectId'], {
        references: {
          collection: 'stockTransfers',
          fields: ['id', 'subjectId'],
        },
        name: 'stock_transfer_line_company_fk',
      });
      for (const [field, table] of [
        ['skuId', 'materialSkus'],
        ['baseUnitId', 'measureUnits'],
        ['unitId', 'measureUnits'],
        ['unitRuleId', 'materialUnitRules'],
      ])
        c.foreignKey(field, {
          references: { collection: table, fields: ['id'] },
          name: `stock_transfer_line_${field}_fk`,
        });
    });
    await builder.createCollection('stockDocuments', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      c.string('code', { length: 64, nullable: false });
      c.unique('code');
      c.string('subjectId', { length: 36, nullable: false });
      c.string('warehouseId', { length: 36, nullable: false });
      c.string('kind', { length: 32, nullable: false });
      c.string('originalDocumentId', { length: 36, nullable: true });
      c.string('issueRequestId', { length: 36, nullable: true });
      c.string('transferId', { length: 36, nullable: true });
      for (const field of [
        'purchaseOrderId',
        'salesOrderId',
        'countId',
        'originalPostingId',
      ])
        c.string(field, { length: 36, nullable: true });
      c.string('initializationReference', { length: 200, nullable: true });
      c.json('productionEvidence', { nullable: true });
      for (const field of ['lossEvidence', 'inspectionEvidence', 'evidence'])
        c.text(field, { nullable: true });
      c.integer('contentVersion', { nullable: false, defaultValue: 1 });
      c.integer('reviewRound', { nullable: false, defaultValue: 0 });
      for (const field of [
        'submittedVersionId',
        'approvedVersionId',
        'supersedesId',
      ])
        c.string(field, { length: 36, nullable: true });
      c.string('submittedBy', { length: 200, nullable: true });
      c.datetimeTz('submittedAt', { nullable: true });
      c.datetimeTz('approvedAt', { nullable: true });
      c.string('nonce', { length: 36, nullable: true });
      c.string('status', { length: 32, nullable: false });
      c.integer('revision', { nullable: false, defaultValue: 1 });
      c.integer('lifecycleVersion', { nullable: false, defaultValue: 0 });
      c.datetimeTz('statusChangedAt', { nullable: false });
      c.date('occurredOn', { nullable: false });
      c.text('reason', { nullable: false });
      c.text('notes', { nullable: false });
      c.string('createdBy', { length: 200, nullable: false });
      c.string('updatedBy', { length: 200, nullable: false });
      c.datetimeTz('createdAt', { nullable: false });
      c.datetimeTz('updatedAt', { nullable: false });
      c.string('postedBy', { length: 200, nullable: true });
      c.datetimeTz('postedAt', { nullable: true });
      c.unique(['id', 'subjectId']);
      c.index(['subjectId', 'warehouseId', 'status']);
      c.index('updatedAt');
      for (const [field, target] of [
        ['purchaseOrderId', 'purchaseOrders'],
        ['salesOrderId', 'salesOrders'],
        ['countId', 'stockCounts'],
      ])
        c.foreignKey([field, 'subjectId'], {
          references: { collection: target, fields: ['id', 'subjectId'] },
          name: `stock_document_${field}_company_fk`,
        });
      c.foreignKey(['transferId', 'subjectId'], {
        references: {
          collection: 'stockTransfers',
          fields: ['id', 'subjectId'],
        },
        name: 'stock_document_transfer_company_fk',
      });
      c.foreignKey(['warehouseId', 'subjectId'], {
        references: { collection: 'warehouses', fields: ['id', 'subjectId'] },
        name: 'stock_document_warehouse_company_fk',
      });
      c.foreignKey(['originalDocumentId', 'subjectId'], {
        references: {
          collection: 'stockDocuments',
          fields: ['id', 'subjectId'],
        },
        name: 'stock_document_original_company_fk',
      });
      c.foreignKey(['issueRequestId', 'subjectId'], {
        references: {
          collection: 'materialIssueRequests',
          fields: ['id', 'subjectId'],
        },
        name: 'stock_document_issue_request_fk',
      });
    });
    await builder.createCollection('stockDocumentLines', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      c.string('documentId', { length: 36, nullable: false });
      c.string('subjectId', { length: 36, nullable: false });
      c.integer('lineNo', { nullable: false });
      c.integer('revision', { nullable: false, defaultValue: 1 });
      c.string('status', { length: 32, nullable: false });
      for (const field of ['skuId', 'baseUnitId', 'unitId'])
        c.string(field, { length: 36, nullable: false });
      c.string('unitRuleId', { length: 36, nullable: true });
      c.string('issueRequestLineId', { length: 36, nullable: true });
      c.string('issueRequestId', { length: 36, nullable: true });
      c.string('originalLineId', { length: 36, nullable: true });
      c.string('nonce', { length: 36, nullable: true });
      c.string('transferId', { length: 36, nullable: true });
      c.string('transferLineId', { length: 36, nullable: true });
      for (const field of [
        'purchaseOrderId',
        'purchaseOrderLineId',
        'salesOrderId',
        'salesOrderLineId',
        'originalDocumentId',
        'sourceBalanceId',
      ])
        c.string(field, { length: 36, nullable: true });
      c.string('returnedQuantity', {
        length: 25,
        nullable: false,
        defaultValue: '0',
      });
      c.string('rejectedQuantity', {
        length: 25,
        nullable: false,
        defaultValue: '0',
      });
      c.boolean('replenishmentRequested', {
        nullable: false,
        defaultValue: false,
      });
      c.string('targetQuality', { length: 32, nullable: true });
      c.text('condition', { nullable: false, defaultValue: '' });
      c.json('selectionInput', { nullable: true });
      c.json('commercialSnapshot', { nullable: true });
      c.json('sourceSnapshot', { nullable: true });
      c.string('quantity', { length: 25, nullable: false });
      c.string('baseQuantity', { length: 25, nullable: false });
      c.string('numeratorSnapshot', { length: 25, nullable: false });
      c.string('denominatorSnapshot', { length: 25, nullable: false });
      c.string('quality', { length: 32, nullable: false });
      c.json('materialSnapshot', { nullable: false });
      c.text('notes', { nullable: false });
      c.unique(['id', 'documentId', 'subjectId']);
      c.unique(['documentId', 'lineNo']);
      c.foreignKey(['documentId', 'subjectId'], {
        references: {
          collection: 'stockDocuments',
          fields: ['id', 'subjectId'],
        },
        name: 'stock_line_document_company_fk',
      });
      for (const [field, table] of [
        ['skuId', 'materialSkus'],
        ['baseUnitId', 'measureUnits'],
        ['unitId', 'measureUnits'],
        ['unitRuleId', 'materialUnitRules'],
        ['originalLineId', 'stockDocumentLines'],
      ])
        c.foreignKey(field, {
          references: { collection: table, fields: ['id'] },
          name: `stock_line_${field}_fk`,
        });
      c.foreignKey(['issueRequestLineId', 'issueRequestId', 'subjectId'], {
        references: {
          collection: 'materialIssueRequestLines',
          fields: ['id', 'requestId', 'subjectId'],
        },
        name: 'stock_line_issue_company_fk',
      });
      c.foreignKey(['transferLineId', 'transferId', 'subjectId'], {
        references: {
          collection: 'stockTransferLines',
          fields: ['id', 'transferId', 'subjectId'],
        },
        name: 'stock_line_transfer_company_fk',
      });
      for (const [line, head, target] of [
        ['purchaseOrderLineId', 'purchaseOrderId', 'purchaseOrderLines'],
        ['salesOrderLineId', 'salesOrderId', 'salesOrderLines'],
      ])
        c.foreignKey([line, head, 'subjectId'], {
          references: {
            collection: target,
            fields: ['id', 'orderId', 'subjectId'],
          },
          name: `stock_line_${line}_company_fk`,
        });
      c.foreignKey(['originalLineId', 'originalDocumentId', 'subjectId'], {
        references: {
          collection: 'stockDocumentLines',
          fields: ['id', 'documentId', 'subjectId'],
        },
        name: 'stock_line_original_company_fk',
      });
    });
    await builder.createCollection('warehouseStockGates', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      c.string('subjectId', { length: 36, nullable: false });
      c.string('nonce', { length: 36, nullable: false });
      c.string('countId', { length: 36, nullable: true });
      c.foreignKey(['id', 'subjectId'], {
        references: { collection: 'warehouses', fields: ['id', 'subjectId'] },
        name: 'stock_gate_warehouse_company_fk',
      });
      c.foreignKey(['countId', 'id', 'subjectId'], {
        references: {
          collection: 'stockCounts',
          fields: ['id', 'warehouseId', 'subjectId'],
        },
        name: 'stock_gate_count_scope_fk',
      });
    });
    await builder.createCollection('stockBalances', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      c.string('dimensionKey', { length: 160, nullable: false });
      c.unique('dimensionKey');
      for (const field of ['subjectId', 'skuId', 'baseUnitId'])
        c.string(field, { length: 36, nullable: false });
      c.string('warehouseId', { length: 36, nullable: true });
      c.string('transferId', { length: 36, nullable: true });
      c.string('quality', { length: 32, nullable: false });
      c.string('quantity', { length: 25, nullable: false });
      c.string('reservedQuantity', { length: 25, nullable: false });
      c.integer('revision', { nullable: false });
      c.string('nonce', { length: 36, nullable: false });
      c.datetimeTz('updatedAt', { nullable: false });
      c.unique(['id', 'subjectId', 'warehouseId', 'skuId', 'quality']);
      c.unique(['id', 'subjectId', 'skuId', 'quality', 'dimensionKey']);
      c.index(['subjectId', 'warehouseId', 'skuId']);
      c.foreignKey(['warehouseId', 'subjectId'], {
        references: { collection: 'warehouses', fields: ['id', 'subjectId'] },
        name: 'stock_balance_warehouse_company_fk',
      });
      c.foreignKey('skuId', {
        references: { collection: 'materialSkus', fields: ['id'] },
        name: 'stock_balance_sku_fk',
      });
      c.foreignKey('baseUnitId', {
        references: { collection: 'measureUnits', fields: ['id'] },
        name: 'stock_balance_unit_fk',
      });
      c.foreignKey(['transferId', 'subjectId'], {
        references: {
          collection: 'stockTransfers',
          fields: ['id', 'subjectId'],
        },
        name: 'stock_balance_transfer_company_fk',
      });
    });
    await builder.createCollection('stockPostings', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      c.string('documentId', { length: 36, nullable: false });
      c.unique('documentId');
      c.string('subjectId', { length: 36, nullable: false });
      c.string('reversesPostingId', { length: 36, nullable: true });
      c.unique('reversesPostingId');
      c.string('fingerprint', { length: 64, nullable: false });
      c.string('actorId', { length: 200, nullable: false });
      c.text('reason', { nullable: false });
      c.datetimeTz('createdAt', { nullable: false });
      c.unique(['id', 'documentId', 'subjectId']);
      c.foreignKey(['documentId', 'subjectId'], {
        references: {
          collection: 'stockDocuments',
          fields: ['id', 'subjectId'],
        },
        name: 'stock_posting_document_company_fk',
      });
      c.foreignKey('reversesPostingId', {
        references: { collection: 'stockPostings', fields: ['id'] },
        name: 'stock_posting_reverse_fk',
      });
    });
    await builder.addConstraint('stockDocuments', {
      type: 'foreignKey',
      fields: ['originalPostingId'],
      name: 'stock_document_original_posting_fk',
      references: { collection: 'stockPostings', fields: ['id'] },
    });
    await builder.addConstraint('stockDocumentLines', {
      type: 'foreignKey',
      fields: ['sourceBalanceId'],
      name: 'stock_line_source_balance_fk',
      references: { collection: 'stockBalances', fields: ['id'] },
    });
    await builder.createCollection('stockCountLines', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      for (const field of [
        'countId',
        'subjectId',
        'warehouseId',
        'skuId',
        'baseUnitId',
      ])
        c.string(field, { length: 36, nullable: false });
      c.string('balanceId', { length: 36, nullable: true });
      c.string('quality', { length: 32, nullable: false });
      c.string('baselineQuantity', { length: 25, nullable: false });
      c.string('actualQuantity', { length: 25, nullable: true });
      c.json('materialSnapshot', { nullable: false });
      c.text('reason', { nullable: false });
      c.text('notes', { nullable: false });
      c.string('countedBy', { length: 200, nullable: true });
      c.integer('revision', { nullable: false });
      c.unique(['countId', 'skuId', 'quality']);
      c.unique(['id', 'countId', 'subjectId']);
      c.foreignKey(['countId', 'warehouseId', 'subjectId'], {
        references: {
          collection: 'stockCounts',
          fields: ['id', 'warehouseId', 'subjectId'],
        },
        name: 'stock_count_line_scope_fk',
      });
      c.foreignKey(
        ['balanceId', 'subjectId', 'warehouseId', 'skuId', 'quality'],
        {
          references: {
            collection: 'stockBalances',
            fields: ['id', 'subjectId', 'warehouseId', 'skuId', 'quality'],
          },
          name: 'stock_count_line_balance_fk',
        },
      );
      for (const [field, target] of [
        ['skuId', 'materialSkus'],
        ['baseUnitId', 'measureUnits'],
      ])
        c.foreignKey(field, {
          references: { collection: target, fields: ['id'] },
          name: `stock_count_line_${field}_fk`,
        });
    });
    await builder.createCollection('purchaseAllocationGates', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      for (const field of ['requestId', 'subjectId'])
        c.string(field, { length: 36, nullable: false });
      c.string('nonce', { length: 36, nullable: false });
      c.foreignKey(['id', 'requestId', 'subjectId'], {
        references: {
          collection: 'purchaseRequestLines',
          fields: ['id', 'requestId', 'subjectId'],
        },
        name: 'purchase_allocation_gate_source_fk',
      });
    });
    await builder.createCollection('purchaseAllocations', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      for (const field of [
        'subjectId',
        'orderId',
        'orderLineId',
        'requestId',
        'requestLineId',
        'requestVersionId',
      ])
        c.string(field, { length: 36, nullable: false });
      c.string('baseQuantity', { length: 25, nullable: false });
      c.string('status', { length: 32, nullable: false });
      c.datetimeTz('createdAt', { nullable: false });
      c.datetimeTz('updatedAt', { nullable: false });
      c.unique(['orderLineId', 'requestLineId']);
      c.index(['requestLineId', 'status']);
      c.foreignKey(['orderLineId', 'orderId', 'subjectId'], {
        references: {
          collection: 'purchaseOrderLines',
          fields: ['id', 'orderId', 'subjectId'],
        },
        name: 'purchase_allocation_order_fk',
      });
      c.foreignKey(['requestLineId', 'requestId', 'subjectId'], {
        references: {
          collection: 'purchaseRequestLines',
          fields: ['id', 'requestId', 'subjectId'],
        },
        name: 'purchase_allocation_source_fk',
      });
      c.foreignKey(['requestVersionId', 'requestId', 'subjectId'], {
        references: {
          collection: 'supplyChainRequestVersions',
          fields: ['id', 'requestId', 'subjectId'],
        },
        name: 'purchase_allocation_version_fk',
      });
    });
    await builder.createCollection('stockInitializations', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      for (const field of ['documentId', 'subjectId', 'warehouseId'])
        c.string(field, { length: 36, nullable: false });
      c.string('reference', { length: 200, nullable: false });
      c.datetimeTz('createdAt', { nullable: false });
      c.unique('documentId');
      c.unique(['subjectId', 'warehouseId', 'reference']);
      c.foreignKey(['documentId', 'subjectId'], {
        references: {
          collection: 'stockDocuments',
          fields: ['id', 'subjectId'],
        },
        name: 'stock_initialization_document_fk',
      });
      c.foreignKey(['warehouseId', 'subjectId'], {
        references: { collection: 'warehouses', fields: ['id', 'subjectId'] },
        name: 'stock_initialization_warehouse_fk',
      });
    });
    await builder.createCollection('executionVersions', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      c.string('kind', { length: 32, nullable: false });
      for (const field of ['documentId', 'subjectId'])
        c.string(field, { length: 36, nullable: false });
      for (const field of [
        'purchaseOrderId',
        'salesOrderId',
        'stockDocumentId',
        'transferId',
        'countId',
      ])
        c.string(field, { length: 36, nullable: true });
      c.integer('contentVersion', { nullable: false });
      c.json('payload', { nullable: false });
      c.datetimeTz('createdAt', { nullable: false });
      c.unique(['kind', 'documentId', 'contentVersion']);
      c.unique(['id', 'kind', 'documentId', 'subjectId']);
      for (const [field, target] of [
        ['purchaseOrderId', 'purchaseOrders'],
        ['salesOrderId', 'salesOrders'],
        ['stockDocumentId', 'stockDocuments'],
        ['transferId', 'stockTransfers'],
        ['countId', 'stockCounts'],
      ])
        c.foreignKey([field, 'subjectId'], {
          references: { collection: target, fields: ['id', 'subjectId'] },
          name: `execution_version_${field}_fk`,
        });
    });
    await builder.createCollection('executionReviewTasks', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      c.string('kind', { length: 32, nullable: false });
      for (const field of ['documentId', 'subjectId', 'versionId'])
        c.string(field, { length: 36, nullable: false });
      c.integer('round', { nullable: false });
      c.string('status', { length: 32, nullable: false });
      c.json('candidates', { nullable: false });
      c.json('excludedActors', { nullable: false });
      c.json('parameterSnapshot', { nullable: true });
      c.string('submittedBy', { length: 200, nullable: false });
      c.string('decidedBy', { length: 200, nullable: true });
      c.text('reason', { nullable: false });
      c.datetimeTz('createdAt', { nullable: false });
      c.datetimeTz('decidedAt', { nullable: true });
      c.unique(['kind', 'documentId', 'round']);
      c.index(['subjectId', 'status']);
      c.foreignKey(['versionId', 'kind', 'documentId', 'subjectId'], {
        references: {
          collection: 'executionVersions',
          fields: ['id', 'kind', 'documentId', 'subjectId'],
        },
        name: 'execution_task_version_scope_fk',
      });
    });
    await builder.createCollection('executionActionRequests', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      c.string('actorId', { length: 200, nullable: false });
      c.string('requestKey', { length: 36, nullable: false });
      c.string('kind', { length: 32, nullable: false });
      c.string('operation', { length: 64, nullable: false });
      c.string('resultId', { length: 36, nullable: false });
      c.string('fingerprint', { length: 64, nullable: false });
      c.datetimeTz('createdAt', { nullable: false });
      c.unique(['actorId', 'requestKey']);
    });
    await builder.createCollection('stockMovements', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      for (const field of [
        'postingId',
        'documentId',
        'documentLineId',
        'subjectId',
        'skuId',
        'baseUnitId',
        'balanceId',
      ])
        c.string(field, { length: 36, nullable: false });
      c.string('warehouseId', { length: 36, nullable: true });
      c.string('transferId', { length: 36, nullable: true });
      c.string('dimensionKey', { length: 160, nullable: false });
      c.integer('ordinal', { nullable: false });
      c.string('quality', { length: 32, nullable: false });
      c.string('deltaQuantity', { length: 26, nullable: false });
      c.datetimeTz('createdAt', { nullable: false });
      c.unique(['postingId', 'ordinal']);
      c.index(['balanceId', 'createdAt']);
      c.foreignKey(['postingId', 'documentId', 'subjectId'], {
        references: {
          collection: 'stockPostings',
          fields: ['id', 'documentId', 'subjectId'],
        },
        name: 'stock_movement_posting_company_fk',
      });
      c.foreignKey(['documentLineId', 'documentId', 'subjectId'], {
        references: {
          collection: 'stockDocumentLines',
          fields: ['id', 'documentId', 'subjectId'],
        },
        name: 'stock_movement_line_company_fk',
      });
      c.foreignKey(
        ['balanceId', 'subjectId', 'skuId', 'quality', 'dimensionKey'],
        {
          references: {
            collection: 'stockBalances',
            fields: ['id', 'subjectId', 'skuId', 'quality', 'dimensionKey'],
          },
          name: 'stock_movement_dimension_fk',
        },
      );
      c.foreignKey(['warehouseId', 'subjectId'], {
        references: { collection: 'warehouses', fields: ['id', 'subjectId'] },
        name: 'stock_movement_warehouse_company_fk',
      });
      c.foreignKey(['transferId', 'subjectId'], {
        references: {
          collection: 'stockTransfers',
          fields: ['id', 'subjectId'],
        },
        name: 'stock_movement_transfer_company_fk',
      });
      c.foreignKey('baseUnitId', {
        references: { collection: 'measureUnits', fields: ['id'] },
        name: 'stock_movement_unit_fk',
      });
    });
    await builder.createCollection('stockIssueFulfillments', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      for (const field of [
        'issueRequestId',
        'subjectId',
        'skuId',
        'baseUnitId',
      ])
        c.string(field, { length: 36, nullable: false });
      c.string('issuedQuantity', { length: 25, nullable: false });
      c.string('returnedQuantity', { length: 25, nullable: false });
      c.integer('revision', { nullable: false });
      c.string('nonce', { length: 36, nullable: false });
      c.foreignKey(['id', 'issueRequestId', 'subjectId'], {
        references: {
          collection: 'materialIssueRequestLines',
          fields: ['id', 'requestId', 'subjectId'],
        },
        name: 'stock_fulfillment_issue_company_fk',
      });
      c.foreignKey('skuId', {
        references: { collection: 'materialSkus', fields: ['id'] },
        name: 'stock_fulfillment_issue_sku_fk',
      });
      c.foreignKey('baseUnitId', {
        references: { collection: 'measureUnits', fields: ['id'] },
        name: 'stock_fulfillment_issue_unit_fk',
      });
    });
    await builder.createCollection('stockReservations', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      for (const field of ['balanceId', 'subjectId', 'warehouseId', 'skuId'])
        c.string(field, { length: 36, nullable: false });
      c.string('sourceKind', {
        length: 32,
        nullable: false,
        defaultValue: 'issue',
      });
      for (const field of [
        'issueRequestId',
        'issueRequestLineId',
        'salesOrderId',
        'salesOrderLineId',
      ])
        c.string(field, { length: 36, nullable: true });
      c.string('quality', { length: 32, nullable: false });
      for (const field of [
        'quantity',
        'consumedQuantity',
        'releasedQuantity',
        'remainingQuantity',
      ])
        c.string(field, { length: 25, nullable: false });
      c.integer('revision', { nullable: false });
      c.string('createdBy', { length: 200, nullable: false });
      c.datetimeTz('createdAt', { nullable: false });
      c.datetimeTz('updatedAt', { nullable: false });
      c.index(['issueRequestLineId', 'warehouseId']);
      c.unique(['id', 'balanceId', 'subjectId']);
      c.foreignKey(
        ['balanceId', 'subjectId', 'warehouseId', 'skuId', 'quality'],
        {
          references: {
            collection: 'stockBalances',
            fields: ['id', 'subjectId', 'warehouseId', 'skuId', 'quality'],
          },
          name: 'stock_reservation_dimension_fk',
        },
      );
      c.foreignKey(['issueRequestLineId', 'issueRequestId', 'subjectId'], {
        references: {
          collection: 'materialIssueRequestLines',
          fields: ['id', 'requestId', 'subjectId'],
        },
        name: 'stock_reservation_issue_line_fk',
      });
      c.foreignKey(['salesOrderLineId', 'salesOrderId', 'subjectId'], {
        references: {
          collection: 'salesOrderLines',
          fields: ['id', 'orderId', 'subjectId'],
        },
        name: 'stock_reservation_sales_line_fk',
      });
    });
    await builder.createCollection('stockReservationConsumptions', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      for (const field of [
        'postingId',
        'documentId',
        'documentLineId',
        'reservationId',
        'balanceId',
        'subjectId',
      ])
        c.string(field, { length: 36, nullable: false });
      c.string('quantity', { length: 25, nullable: false });
      c.string('kind', {
        length: 16,
        nullable: false,
        defaultValue: 'consume',
      });
      c.string('originalConsumptionId', { length: 36, nullable: true });
      c.boolean('restoredActive', { nullable: true });
      c.unique('originalConsumptionId');
      c.foreignKey('originalConsumptionId', {
        references: {
          collection: 'stockReservationConsumptions',
          fields: ['id'],
        },
        name: 'stock_consumption_original_fk',
      });
      c.datetimeTz('createdAt', { nullable: false });
      c.unique(['postingId', 'documentLineId', 'reservationId']);
      c.foreignKey(['postingId', 'documentId', 'subjectId'], {
        references: {
          collection: 'stockPostings',
          fields: ['id', 'documentId', 'subjectId'],
        },
        name: 'stock_consumption_posting_fk',
      });
      c.foreignKey(['documentLineId', 'documentId', 'subjectId'], {
        references: {
          collection: 'stockDocumentLines',
          fields: ['id', 'documentId', 'subjectId'],
        },
        name: 'stock_consumption_line_fk',
      });
      c.foreignKey(['reservationId', 'balanceId', 'subjectId'], {
        references: {
          collection: 'stockReservations',
          fields: ['id', 'balanceId', 'subjectId'],
        },
        name: 'stock_consumption_reservation_fk',
      });
    });
    await builder.createCollection('stockActionRequests', (c) => {
      c.string('id', { length: 36, nullable: false });
      c.primary('id');
      c.string('actorId', { length: 200, nullable: false });
      c.string('requestKey', { length: 36, nullable: false });
      c.unique(['actorId', 'requestKey']);
      c.string('action', { length: 32, nullable: false });
      c.string('documentId', { length: 36, nullable: true });
      c.string('postingId', { length: 36, nullable: true });
      c.string('reservationId', { length: 36, nullable: true });
      c.string('fingerprint', { length: 64, nullable: false });
      c.datetimeTz('createdAt', { nullable: false });
      c.foreignKey('documentId', {
        references: { collection: 'stockDocuments', fields: ['id'] },
        name: 'stock_action_document_fk',
      });
      c.foreignKey('postingId', {
        references: { collection: 'stockPostings', fields: ['id'] },
        name: 'stock_action_posting_fk',
      });
      c.foreignKey('reservationId', {
        references: { collection: 'stockReservations', fields: ['id'] },
        name: 'stock_action_reservation_fk',
      });
    });
    const client = await connection.client<{
      raw(sql: string): Promise<unknown>;
    }>();
    const identifiers = (table: string, fields: string[]) => {
      let physical = '';
      const columns = fields.map((field) => {
        const q = query.selectFrom(table).select(field).compile();
        const m = /^select (.+?) as ["`][^"`]+["`] from (.+)$/iu.exec(q.sql);
        const valid = /^(?:(?:"[^"]+"|`[^`]+`)\.)?(?:"[^"]+"|`[^`]+`)$/u;
        if (!m || q.parameters.length || !valid.test(m[1]) || !valid.test(m[2]))
          throw new Error('Cannot resolve stock constraint identifiers');
        physical = m[2];
        return m[1];
      });
      return { physical, columns };
    };
    const decimal = (field: string) =>
      connection.dialect === 'postgres'
        ? `${field} ~ '^(0|[1-9][0-9]{0,17})([.][0-9]{1,6}){0,1}$'`
        : `${field} <> '' AND length(${field}) <= 25 AND ${field} NOT GLOB '*[^0-9.]*' AND length(${field})-length(replace(${field},'.','')) <= 1 AND substr(${field},1,1) <> '.' AND substr(${field},-1,1) <> '.' AND ((instr(${field},'.')=0 AND length(${field}) <= 18) OR (instr(${field},'.') BETWEEN 2 AND 19 AND length(${field})-instr(${field},'.') BETWEEN 1 AND 6)) AND (substr(${field},1,1) <> '0' OR length(${field})=1 OR substr(${field},2,1)='.')`;
    const padded = (v: string) =>
      `CASE WHEN instr(${v},'.')=0 THEN substr('000000000000000000'||${v},-18)||'000000' ELSE substr('000000000000000000'||substr(${v},1,instr(${v},'.')-1),-18)||substr(substr(${v},instr(${v},'.')+1)||'000000',1,6) END`;
    const noGreater = (a: string, b: string) =>
      connection.dialect === 'postgres'
        ? `CAST(${a} AS NUMERIC(24,6))<=CAST(${b} AS NUMERIC(24,6))`
        : `(${padded(a)})<=(${padded(b)})`;
    const sumEqual = (target: string, parts: string[]) => {
      if (connection.dialect === 'postgres')
        return `CAST(${target} AS NUMERIC(24,6))=${parts.map((v) => `CAST(${v} AS NUMERIC(24,6))`).join('+')}`;
      // Three integer limbs keep all 24 fixed-point digits exact in SQLite,
      // whose NUMERIC affinity would otherwise round these values to REAL.
      const limb = (v: string, start: number) =>
          `CAST(substr((${padded(v)}),${start},8) AS INTEGER)`,
        low = `(${parts.map((v) => limb(v, 17)).join('+')})`,
        middle = `(${parts.map((v) => limb(v, 9)).join('+')}+${low}/100000000)`,
        high = `(${parts.map((v) => limb(v, 1)).join('+')}+${middle}/100000000)`;
      return `${limb(target, 17)}=${low}%100000000 AND ${limb(target, 9)}=${middle}%100000000 AND ${limb(target, 1)}=${high}`;
    };
    const checks: [string, string[], (f: string[]) => string][] = [
      ...['purchaseOrders', 'salesOrders', 'stockCounts'].map(
        (table): [string, string[], (f: string[]) => string] => [
          table,
          [
            'revision',
            'lifecycleVersion',
            'contentVersion',
            'reviewRound',
            'status',
          ],
          (f) =>
            `${f[0]}>=1 AND ${f[1]}>=0 AND ${f[2]}>=1 AND ${f[3]}>=0 AND ${f[4]} IN (${table === 'stockCounts' ? "'draft','counting','pending','posted','cancelled'" : "'draft','pending','approved','cancelled'"})`,
        ],
      ),
      ...['purchaseOrderLines', 'salesOrderLines'].map(
        (table): [string, string[], (f: string[]) => string] => [
          table,
          [
            'revision',
            'lineNo',
            'status',
            'quantity',
            'baseQuantity',
            'fulfilledQuantity',
            'returnedQuantity',
            'replacementQuantity',
            'closedQuantity',
          ],
          (f) =>
            `${f[0]}>=1 AND ${f[1]}>=1 AND ${f[2]} IN ('active','cancelled') AND ${f
              .slice(3)
              .map((v) => `(${decimal(v)})`)
              .join(' AND ')} AND ${noGreater(f[6], f[5])}`,
        ],
      ),
      [
        'stockCountLines',
        ['revision', 'quality', 'baselineQuantity', 'actualQuantity'],
        (f) =>
          `${f[0]}>=1 AND ${f[1]} IN ('qualified','inspection','frozen') AND (${decimal(f[2])}) AND (${f[3]} IS NULL OR (${decimal(f[3])}))`,
      ],
      [
        'purchaseAllocations',
        ['baseQuantity', 'status'],
        (f) =>
          `(${decimal(f[0])}) AND CAST(${f[0]} AS DECIMAL)>0 AND ${f[1]} IN ('active','cancelled')`,
      ],
      [
        'executionVersions',
        [
          'kind',
          'documentId',
          'contentVersion',
          'purchaseOrderId',
          'salesOrderId',
          'stockDocumentId',
          'transferId',
          'countId',
        ],
        (f) =>
          `${f[2]}>=1 AND (${[
            'purchaseOrders',
            'salesOrders',
            'stockDocuments',
            'stockTransfers',
            'stockCounts',
          ]
            .map(
              (kind, index) =>
                `(${f[0]}='${kind}' AND ${f[index + 3]} IS NOT NULL AND ${f[1]}=${f[index + 3]} AND ${f
                  .slice(3)
                  .filter((_, j) => j !== index)
                  .map((v) => `${v} IS NULL`)
                  .join(' AND ')})`,
            )
            .join(' OR ')})`,
      ],
      [
        'executionReviewTasks',
        ['round', 'status'],
        (f) =>
          `${f[0]}>=1 AND ${f[1]} IN ('pending','approved','returned','closed')`,
      ],
      [
        'stockTransfers',
        [
          'revision',
          'lifecycleVersion',
          'warehouseId',
          'destinationWarehouseId',
          'status',
        ],
        (f) =>
          `${f[0]}>=1 AND ${f[1]}>=0 AND ${f[2]}<>${f[3]} AND ${f[4]} IN ('draft','pending','approved','cancelled')`,
      ],
      [
        'stockTransferLines',
        [
          'revision',
          'lineNo',
          'quality',
          'quantity',
          'baseQuantity',
          'dispatchedQuantity',
          'receivedQuantity',
          'discrepancyQuantity',
        ],
        (f) =>
          `${f[0]}>=1 AND ${f[1]}>=1 AND ${f[2]}='qualified' AND ${f
            .slice(3)
            .map((v) => `(${decimal(v)})`)
            .join(
              ' AND ',
            )} AND ${noGreater(f[5], f[4])} AND ${noGreater(f[6], f[5])} AND ${noGreater(f[7], f[5])}`,
      ],
      [
        'stockDocuments',
        ['revision', 'lifecycleVersion', 'status'],
        (f) =>
          `${f[0]}>=1 AND ${f[1]}>=0 AND ${f[2]} IN ('draft','pending','approved','posted','cancelled')`,
      ],
      [
        'stockDocumentLines',
        ['revision', 'lineNo', 'quality', 'quantity', 'baseQuantity'],
        (f) =>
          `${f[0]}>=1 AND ${f[1]}>=1 AND ${f[2]} IN ('qualified','inspection','frozen') AND (${decimal(f[3])}) AND (${decimal(f[4])})`,
      ],
      [
        'stockBalances',
        [
          'revision',
          'quality',
          'quantity',
          'reservedQuantity',
          'subjectId',
          'warehouseId',
          'skuId',
          'dimensionKey',
          'transferId',
        ],
        (f) => {
          const available = noGreater(f[3], f[2]);
          return `${f[0]}>=1 AND ${f[1]} IN ('qualified','inspection','frozen') AND (${decimal(f[2])}) AND (${decimal(f[3])}) AND ${available} AND ((${f[1]}='qualified' AND ${f[8]} IS NULL) OR CAST(${f[3]} AS DECIMAL)=0) AND ((${f[5]} IS NOT NULL AND ${f[8]} IS NULL AND ${f[7]}=${f[4]}||':warehouse:'||${f[5]}||':'||${f[6]}||':'||${f[1]}) OR (${f[5]} IS NULL AND ${f[8]} IS NOT NULL AND ${f[7]}=${f[4]}||':transit:'||${f[8]}||':'||${f[6]}||':'||${f[1]}))`;
        },
      ],
      [
        'stockMovements',
        [
          'ordinal',
          'deltaQuantity',
          'warehouseId',
          'transferId',
          'dimensionKey',
          'subjectId',
          'skuId',
          'quality',
        ],
        (f) => {
          const unsigned =
            connection.dialect === 'postgres'
              ? `CASE WHEN left(${f[1]},1)='-' THEN substr(${f[1]},2) ELSE ${f[1]} END`
              : `CASE WHEN substr(${f[1]},1,1)='-' THEN substr(${f[1]},2) ELSE ${f[1]} END`;
          return `${f[0]}>=1 AND (${decimal(`(${unsigned})`)}) AND CAST(${f[1]} AS DECIMAL)<>0 AND ((${f[2]} IS NOT NULL AND ${f[3]} IS NULL AND ${f[4]}=${f[5]}||':warehouse:'||${f[2]}||':'||${f[6]}||':'||${f[7]}) OR (${f[2]} IS NULL AND ${f[3]} IS NOT NULL AND ${f[4]}=${f[5]}||':transit:'||${f[3]}||':'||${f[6]}||':'||${f[7]}))`;
        },
      ],
      [
        'stockIssueFulfillments',
        ['revision', 'issuedQuantity', 'returnedQuantity'],
        (f) =>
          `${f[0]}>=1 AND (${decimal(f[1])}) AND (${decimal(f[2])}) AND ${noGreater(f[2], f[1])}`,
      ],
      [
        'stockReservations',
        [
          'revision',
          'quality',
          'quantity',
          'consumedQuantity',
          'releasedQuantity',
          'remainingQuantity',
          'sourceKind',
          'issueRequestId',
          'issueRequestLineId',
          'salesOrderId',
          'salesOrderLineId',
        ],
        (f) =>
          `${f[0]}>=1 AND ${f[1]}='qualified' AND ${f
            .slice(2, 6)
            .map((v) => `(${decimal(v)})`)
            .join(
              ' AND ',
            )} AND (${sumEqual(f[2], f.slice(3, 6))}) AND ((${f[6]}='issue' AND ${f[7]} IS NOT NULL AND ${f[8]} IS NOT NULL AND ${f[9]} IS NULL AND ${f[10]} IS NULL) OR (${f[6]}='sales' AND ${f[7]} IS NULL AND ${f[8]} IS NULL AND ${f[9]} IS NOT NULL AND ${f[10]} IS NOT NULL))`,
      ],
      [
        'stockReservationConsumptions',
        ['quantity', 'kind', 'originalConsumptionId', 'restoredActive'],
        (f) =>
          `(${decimal(f[0])}) AND CAST(${f[0]} AS DECIMAL)>0 AND ((${f[1]}='consume' AND ${f[2]} IS NULL AND ${f[3]} IS NULL) OR (${f[1]}='restore' AND ${f[2]} IS NOT NULL AND ${f[3]} IS NOT NULL))`,
      ],
    ];
    for (const [table, fields, predicate] of checks) {
      const { physical, columns } = identifiers(table, fields);
      if (connection.dialect === 'postgres')
        await client.raw(
          `ALTER TABLE ${physical} ADD CONSTRAINT "${table}_bounds" CHECK (${predicate(columns)})`,
        );
      else if (connection.dialect === 'sqlite')
        for (const event of ['INSERT', 'UPDATE'])
          await client.raw(
            `CREATE TRIGGER "${table}_bounds_${event}" BEFORE ${event} ON ${physical} FOR EACH ROW WHEN NOT (${predicate(columns.map((c) => 'NEW.' + c))}) BEGIN SELECT RAISE(ABORT, 'Invalid stock quantity or state'); END`,
          );
      else throw new Error('Inventory requires PostgreSQL or SQLite');
    }
    for (const table of [
      'stockMovements',
      'stockPostings',
      'stockReservationConsumptions',
      'executionVersions',
    ]) {
      const { physical } = identifiers(table, ['id']);
      if (connection.dialect === 'postgres') {
        await client.raw(
          `CREATE FUNCTION "${table}_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Posted inventory facts are immutable'; END $$`,
        );
        await client.raw(
          `CREATE TRIGGER "${table}_immutable" BEFORE UPDATE OR DELETE ON ${physical} FOR EACH ROW EXECUTE FUNCTION "${table}_immutable"()`,
        );
      } else
        for (const event of ['UPDATE', 'DELETE'])
          await client.raw(
            `CREATE TRIGGER "${table}_immutable_${event}" BEFORE ${event} ON ${physical} FOR EACH ROW BEGIN SELECT RAISE(ABORT, 'Posted inventory facts are immutable'); END`,
          );
    }
  },
  async down({ builder, connection }) {
    const client = await connection.client<{
      raw(sql: string): Promise<unknown>;
    }>();
    // SQLite rebuilds a table when removing a FK. The whole reverse removes
    // these new cyclic references before commit; old application data remains.
    if (connection.dialect === 'sqlite')
      await client.raw('PRAGMA defer_foreign_keys = ON');
    await builder.dropConstraint(
      'stockDocuments',
      'stock_document_original_posting_fk',
    );
    await builder.dropConstraint(
      'stockDocumentLines',
      'stock_line_source_balance_fk',
    );
    for (const table of [
      'executionActionRequests',
      'executionReviewTasks',
      'executionVersions',
      'purchaseAllocations',
      'purchaseAllocationGates',
      'stockInitializations',
      'stockActionRequests',
      'stockReservationConsumptions',
      'stockReservations',
      'stockIssueFulfillments',
      'stockMovements',
      'stockCountLines',
      'stockPostings',
      'stockBalances',
      'warehouseStockGates',
      'stockDocumentLines',
      'stockDocuments',
      'stockTransferLines',
      'stockTransfers',
      'purchaseOrderLines',
      'salesOrderLines',
      'purchaseOrders',
      'salesOrders',
      'stockCounts',
    ])
      await builder.dropCollection(table);
    if (connection.dialect === 'postgres') {
      for (const table of [
        'stockMovements',
        'stockPostings',
        'stockReservationConsumptions',
        'executionVersions',
      ])
        await client.raw(`DROP FUNCTION "${table}_immutable"()`);
    }
    await builder.dropConstraint(
      'warehouses',
      'warehouse_stock_company_identity',
    );
    if (connection.dialect === 'sqlite') {
      const violations = await client.raw('PRAGMA foreign_key_check');
      if (!Array.isArray(violations) || violations.length)
        throw new Error('Inventory rollback left invalid foreign keys');
      await client.raw('PRAGMA defer_foreign_keys = OFF');
    }
  },
});
