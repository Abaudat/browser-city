//! Story 6.3 (FR89): the one test-side ledger. It applies a `Write` and
//! nothing else, so the test ledger has no author-less mutation path.

use sim::stock::{HolderRef, Plan, StockLine, Write};

#[derive(Default)]
pub struct Ledger {
    lines: Vec<StockLine>,
    next_row: u64,
}

impl Ledger {
    pub fn from_lines(lines: Vec<StockLine>) -> Self {
        let next_row = lines.iter().map(|l| l.row_id).max().unwrap_or(0);
        Self { lines, next_row }
    }

    pub fn lines(&self) -> &[StockLine] {
        &self.lines
    }

    pub fn apply(&mut self, write: &Write) {
        match write.plan() {
            Plan::Insert { quantity } => {
                self.next_row += 1;
                self.lines.push(StockLine {
                    row_id: self.next_row,
                    holder: write.holder(),
                    item_id: write.item_id(),
                    quantity,
                });
            }
            Plan::Update { row_id, quantity } => {
                self.lines
                    .iter_mut()
                    .find(|l| l.row_id == row_id)
                    .expect("an update names a held row")
                    .quantity = quantity;
            }
            Plan::Delete { row_id } => self.lines.retain(|l| l.row_id != row_id),
            Plan::Nothing => {}
        }
    }

    pub fn quantity(&self, holder: HolderRef, item: u32) -> u64 {
        self.lines
            .iter()
            .filter(|l| l.holder == holder && l.item_id == item)
            .map(|l| l.quantity)
            .sum()
    }
}
