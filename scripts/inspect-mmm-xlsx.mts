import { readFileSync } from 'fs'
import * as XLSX from 'xlsx'

const buf = readFileSync('/Users/levan/Downloads/MMM_Test_Dataset_260weeks.xlsx')
const wb = XLSX.read(buf, { type: 'buffer', cellDates: true })
console.log('sheets', wb.SheetNames)
for (const name of wb.SheetNames) {
  const sheet = wb.Sheets[name]
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }) as unknown[][]
  console.log('\n===', name, 'rows', rows.length, 'cols', (rows[0] as unknown[])?.length)
  console.log('header', JSON.stringify(rows[0]))
  console.log('row1', JSON.stringify(rows[1]))
  console.log('row2', JSON.stringify(rows[2]))
  console.log('last', JSON.stringify(rows[rows.length - 1]))
}
