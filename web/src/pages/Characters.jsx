import { useState } from 'react';
import CharacterList from '../components/CharacterList.jsx';
import { Header } from '../ui.jsx';

export default function Characters() {
  const [adding, setAdding] = useState(false);
  return (
    <div>
      <Header
        title="我的人物"
        right={
          <button className="btn btn-primary btn-xs" onClick={() => setAdding(true)}>
            ＋ 上传
          </button>
        }
      />
      <div className="section">
        <p className="small muted" style={{ marginBottom: 12 }}>
          人物模板用于合拍与换装，照片仅你本人可见（通过带有效期的签名链接访问）。
        </p>
        <CharacterList adding={adding} onAddingChange={setAdding} emptyAction />
      </div>
    </div>
  );
}
