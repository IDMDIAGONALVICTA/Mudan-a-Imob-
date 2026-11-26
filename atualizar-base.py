"""Atualiza data/base.json a partir da planilha de corretores.
Uso:  python3 atualizar-base.py "Base_Informaçãoes_Imob.xlsx"      (precisa de pandas e openpyxl)
Colunas esperadas, na ordem: Corretor | CPF/CNPJ | Imobiliária | GERENTE | (e-mails ignorados)."""
import sys, json, pandas as pd
df = pd.read_excel(sys.argv[1], dtype=str)
df = df.iloc[:, :4]; df.columns = ['n', 'doc', 'i', 'g']
for c in df.columns: df[c] = df[c].str.strip()
df['d'] = df.doc.str.replace(r'\D', '', regex=True)
df['t'] = df.d.str.len().map({11: 'CPF', 14: 'CNPJ'})
cor = [dict(n=r.n, d=r.d, t=r.t, i=r.i, g=r.g) for r in df.itertuples()]
imobs = sorted(i for i in df.i.unique() if i.lower() != 'x')
q = {}
for imob, grp in df.groupby('i'):
    gs = set(grp.g) - {'SEM EQUIPE'}
    if len(gs) == 1: q[imob] = list(gs)[0]
json.dump({'corretores': cor, 'imobiliarias': imobs, 'equipeDaImobiliaria': q}, open('data/base.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(len(cor), 'corretores,', len(imobs), 'imobiliárias,', len(q), 'com equipe definida. Reinicie o servidor.')
