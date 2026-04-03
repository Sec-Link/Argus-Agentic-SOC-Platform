import React, { useState } from 'react';
import { Form, Input, Button, message, Card } from 'antd';
import { login } from 'services/accounts';
import { UserOutlined, LockOutlined } from '@ant-design/icons';

interface Props { onLogin: () => void }

const LoginForm: React.FC<Props> = ({ onLogin }) => {
  const [loading, setLoading] = useState(false);

  const submit = async (values: any) => {
    setLoading(true);
    try {
      const res = await login(values.username, values.password);
      message.success(`Login succeeded: ${res?.user?.username || values.username}`);
      onLogin();
    } catch (e:any) {
      console.error('Login error', e);
      message.error(e?.response?.data?.detail || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-cyber-wrap">
      <div className="login-cyber-bg-grid" />
      <div className="login-cyber-glow login-cyber-glow-a" />
      <div className="login-cyber-glow login-cyber-glow-b" />
      <Card className="login-cyber-card">
        <h2 style={{ textAlign: 'center', marginBottom: 24, color: '#d8e8ff' }}>Login</h2>
        <Form 
          onFinish={(values) => submit(values)} 
          style={{ maxWidth: 320, margin: '0 auto' }}
        >
          <Form.Item 
            name="username" 
            rules={[{ required: true, message: 'Please Input Username' }]}
          >
            <Input 
              prefix={<UserOutlined style={{ color: 'rgba(216, 232, 255, 0.72)' }} />} 
              placeholder="Username" 
              style={{ background: '#071427', borderColor: '#2b4d7a', color: '#d8e8ff' }}
              onChange={() => {}} 
            />
          </Form.Item>
          <Form.Item 
            name="password" 
            rules={[{ required: true, message: 'Please Input Password' }]}
          >
            <Input.Password 
              prefix={<LockOutlined style={{ color: 'rgba(216, 232, 255, 0.72)' }} />} 
              placeholder="Password" 
              style={{ background: '#071427', borderColor: '#2b4d7a', color: '#d8e8ff' }}
              onChange={() => {}} 
            />
          </Form.Item>
          <Button 
            type="primary" 
            htmlType="submit" 
            loading={loading} 
            block
            style={{ background: 'linear-gradient(90deg, #2c6dff, #5ba6ff)', border: 'none', fontWeight: 700, color: '#031a3d' }}
            onClick={() => {}} 
          >
            Login
          </Button>
        </Form>
      </Card>
    </div>
  );
};

export default LoginForm;
