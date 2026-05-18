-- Payment History: Track each payment occurrence for recurring payments
-- Also adds pause functionality

-- Tabela za istoriju plaćanja
CREATE TABLE payment_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  amount NUMERIC(10, 2) NOT NULL,
  due_date DATE NOT NULL,
  paid_date TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_payment_history_payment_id ON payment_history(payment_id);
CREATE INDEX idx_payment_history_family_id ON payment_history(family_id);
CREATE INDEX idx_payment_history_due_date ON payment_history(due_date);

ALTER TABLE payment_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view payment history" ON payment_history
  FOR SELECT USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Members can insert payment history" ON payment_history
  FOR INSERT WITH CHECK (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));

-- Dodati is_paused kolonu na payments tabelu
ALTER TABLE payments ADD COLUMN is_paused BOOLEAN NOT NULL DEFAULT false;
