-- Add DELETE policy for payment_history table
CREATE POLICY "Members can delete payment history" ON payment_history
  FOR DELETE USING (family_id IN (SELECT family_id FROM profiles WHERE id = auth.uid()));
