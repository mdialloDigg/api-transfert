const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType } = require('docx');

// ================= EXPORT EXCEL =================
app.get('/transferts/excel', requireLogin, async (req, res) => {
  const transferts = await Transfert.find().sort({ createdAt: -1 });
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Transferts');

  // En-têtes
  sheet.columns = [
    { header: 'Code', key: 'code', width: 15 },
    { header: 'Type', key: 'userType', width: 20 },
    { header: 'Expéditeur', key: 'sender', width: 30 },
    { header: 'Origine', key: 'originLocation', width: 15 },
    { header: 'Destinataire', key: 'receiver', width: 30 },
    { header: 'Destination', key: 'destinationLocation', width: 15 },
    { header: 'Montant', key: 'amount', width: 12 },
    { header: 'Frais', key: 'fees', width: 12 },
    { header: 'Reçu', key: 'recoveryAmount', width: 12 },
    { header: 'Devise', key: 'currency', width: 10 },
    { header: 'Statut', key: 'status', width: 12 },
    { header: 'Date', key: 'createdAt', width: 20 },
  ];

  transferts.forEach(t => {
    sheet.addRow({
      code: t.code,
      userType: t.userType,
      sender: `${t.senderFirstName} ${t.senderLastName} (${t.senderPhone})`,
      originLocation: t.originLocation,
      receiver: `${t.receiverFirstName} ${t.receiverLastName} (${t.receiverPhone})`,
      destinationLocation: t.destinationLocation,
      amount: t.amount,
      fees: t.fees,
      recoveryAmount: t.recoveryAmount,
      currency: t.currency,
      status: t.retired ? 'Retiré' : 'Non retiré',
      createdAt: t.createdAt.toLocaleString(),
    });
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="transferts.xlsx"`);

  await workbook.xlsx.write(res);
  res.end();
});

// ================= EXPORT WORD =================
app.get('/transferts/word', requireLogin, async (req, res) => {
  const transferts = await Transfert.find().sort({ createdAt: -1 });

  const doc = new Document({
    sections: [{
      properties: {},
      children: [
        new Paragraph({ text: 'Liste des Transferts', heading: 'Heading1' }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              children: [
                'Code','Type','Expéditeur','Origine','Destinataire','Destination','Montant','Frais','Reçu','Devise','Statut','Date'
              ].map(text => new TableCell({ children: [new Paragraph({ text, bold: true })] }))
            }),
            ...transferts.map(t => new TableRow({
              children: [
                t.code,
                t.userType,
                `${t.senderFirstName} ${t.senderLastName} (${t.senderPhone})`,
                t.originLocation,
                `${t.receiverFirstName} ${t.receiverLastName} (${t.receiverPhone})`,
                t.destinationLocation,
                t.amount.toString(),
                t.fees.toString(),
                t.recoveryAmount.toString(),
                t.currency,
                t.retired ? 'Retiré' : 'Non retiré',
                t.createdAt.toLocaleString()
              ].map(text => new TableCell({ children: [new Paragraph(text)] }))
            }))
          ]
        })
      ]
    }]
  });

  const buffer = await Packer.toBuffer(doc);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', `attachment; filename="transferts.docx"`);
  res.send(buffer);
});
