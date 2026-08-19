// Leitor de NF-e (Nota Fiscal Eletrônica) a partir do XML — sem nenhuma
// biblioteca externa de parsing de XML. O layout da NF-e (modelo 4.0) é
// bem padronizado pelo governo (SEFAZ), então dá pra extrair os campos que
// importam com expressões regulares simples, sem precisar de um parser de
// XML completo (DOM/SAX) só pra isso.
//
// Isso é só LEITURA de um arquivo que o fornecedor já te mandou (o XML da
// nota de compra) — não emite nada, não consulta a SEFAZ, não precisa de
// certificado digital nem de nenhuma API paga.

function tag(xml, name) {
  // Pega o conteúdo de <name>...</name>, ignorando atributos na tag de
  // abertura (ex: <det nItem="1">).
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([^<]*)</${name}>`));
  return m ? decodeEntities(m[1].trim()) : "";
}

function decodeEntities(str) {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function num(str) {
  const n = parseFloat(String(str || "0").replace(",", "."));
  return isNaN(n) ? 0 : n;
}

/**
 * Extrai os dados relevantes de um XML de NF-e para dar entrada de estoque.
 * @param {string} xmlString - conteúdo bruto do arquivo .xml da nota
 * @returns {{ chave: string, number: string, series: string, issueDate: string,
 *             supplierName: string, supplierCnpj: string,
 *             items: Array<{ code: string, description: string, ncm: string,
 *                             qty: number, unitPrice: number, totalPrice: number }> }}
 */
function parseNfeXml(xmlString) {
  if (!xmlString || typeof xmlString !== "string") {
    throw new Error("Arquivo XML vazio ou inválido.");
  }
  // Remove quebras de linha dentro das tags pra não atrapalhar as regex —
  // alguns emissores formatam o XML "bonito" com indentação.
  const xml = xmlString.replace(/>\s+</g, "><");

  // Chave de acesso: vem no atributo Id="NFe44DIGITOS" da tag <infNFe>, ou
  // como <chNFe> em alguns XMLs de protocolo/distribuição.
  let chave = "";
  const idMatch = xml.match(/<infNFe[^>]*\sId="NFe(\d{44})"/i);
  if (idMatch) {
    chave = idMatch[1];
  } else {
    const chMatch = xml.match(/<chNFe>(\d{44})<\/chNFe>/i);
    if (chMatch) chave = chMatch[1];
  }

  const ideMatch = xml.match(/<ide>([\s\S]*?)<\/ide>/);
  const ideBlock = ideMatch ? ideMatch[1] : "";

  const emitMatch = xml.match(/<emit>([\s\S]*?)<\/emit>/);
  const emitBlock = emitMatch ? emitMatch[1] : "";

  // Valor total da nota (soma de produtos, frete, impostos etc já calculada
  // pelo emissor) — usado só pra exibir no resumo antes da confirmação,
  // não entra em nenhum cálculo do estoque.
  const totalMatch = xml.match(/<ICMSTot>([\s\S]*?)<\/ICMSTot>/);
  const totalValue = totalMatch ? num(tag(totalMatch[1], "vNF")) : 0;

  const detBlocks = [...xml.matchAll(/<det\s[^>]*>([\s\S]*?)<\/det>/g)].map((m) => m[1]);
  if (detBlocks.length === 0) {
    throw new Error("Não encontramos nenhum item (<det>) nesse XML — confira se é mesmo o arquivo da NF-e, não o do protocolo/DANFE.");
  }

  const items = detBlocks.map((block) => {
    const prodMatch = block.match(/<prod>([\s\S]*?)<\/prod>/);
    const prod = prodMatch ? prodMatch[1] : block;
    // Código de barras (GTIN/EAN): cEAN é o do produto conforme cadastrado
    // pelo fornecedor, cEANTrib é o da unidade tributável (às vezes é o
    // único preenchido). Quando não tem código de barras, o emissor
    // costuma preencher "SEM GTIN" em vez de deixar vazio.
    const rawEan = tag(prod, "cEAN") || tag(prod, "cEANTrib");
    const barcode = rawEan && rawEan.toUpperCase() !== "SEM GTIN" ? rawEan : "";

    // CST/CSOSN (situação tributária do ICMS): fica dentro de <imposto>,
    // num sub-bloco que muda de nome conforme o regime do emitente
    // (ICMS00, ICMS10, ICMS20... para regime normal, ou ICMSSN101,
    // ICMSSN102... para o Simples Nacional). Em vez de tentar prever qual
    // sub-bloco vem, procura direto por <CST> ou <CSOSN> dentro do bloco
    // de imposto do item — sempre um dos dois aparece.
    const impostoMatch = block.match(/<imposto>([\s\S]*?)<\/imposto>/);
    const impostoBlock = impostoMatch ? impostoMatch[1] : "";
    const cst = tag(impostoBlock, "CST") || tag(impostoBlock, "CSOSN");

    return {
      code: tag(prod, "cProd"),
      barcode,
      description: tag(prod, "xProd"),
      ncm: tag(prod, "NCM"),
      cst,
      qty: num(tag(prod, "qCom")),
      unitPrice: num(tag(prod, "vUnCom")),
      totalPrice: num(tag(prod, "vProd"))
    };
  });

  return {
    chave,
    number: tag(ideBlock, "nNF"),
    series: tag(ideBlock, "serie"),
    issueDate: tag(ideBlock, "dhEmi") || tag(ideBlock, "dEmi"),
    supplierName: tag(emitBlock, "xNome"),
    supplierCnpj: tag(emitBlock, "CNPJ"),
    totalValue,
    items
  };
}

module.exports = { parseNfeXml };
